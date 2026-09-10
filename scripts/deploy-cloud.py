"""Update the existing Socrates image after the GitHub workflow's test gates.

Uses GitHub OIDC credentials configured by google-github-actions/auth. Runtime
settings, other containers, traffic, IAM and secret references are preserved.
"""
import copy
import json
import os
import re
import subprocess
import time
import urllib.error
import urllib.request


def main():
    env = os.environ
    project, region, service = env['GCP_PROJECT'], env['GCP_REGION'], env['CLOUD_RUN_SERVICE']
    commit, image, image_digest = env['GITHUB_SHA'], env['IMAGE_NAME'], env['IMAGE_DIGEST']
    if (project, region, service, image) != ('leonas-friends', 'us-west2', 'socrates', 'us-west2-docker.pkg.dev/leonas-friends/socrates/app'):
        raise RuntimeError('Unexpected production deployment target.')
    if env.get('GITHUB_REF') != 'refs/heads/main' or env.get('GITHUB_REPOSITORY') != 'yuzhu9387/socrates.':
        raise RuntimeError('Only this repository main branch can deploy.')
    if not re.fullmatch(r'[a-f0-9]{40}', commit) or not re.fullmatch(re.escape(image) + r'@sha256:[a-f0-9]{64}', image_digest):
        raise RuntimeError('A full commit SHA and exact immutable image digest are required.')
    run_id, attempt = env['GITHUB_RUN_ID'], env['GITHUB_RUN_ATTEMPT']
    if not re.fullmatch(r'[1-9][0-9]{0,19}', run_id) or not re.fullmatch(r'[1-9][0-9]{0,5}', attempt):
        raise RuntimeError('Valid GitHub run and attempt identifiers are required.')
    order = run_id.zfill(20) + attempt.zfill(6)
    access_token = subprocess.check_output(['gcloud', 'auth', 'print-access-token'], text=True).strip()
    name = f'projects/{project}/locations/{region}/services/{service}'
    service_url = f'https://run.googleapis.com/v2/{name}'

    def cloud_request(url, method='GET', body=None):
        data = None if body is None else json.dumps(body).encode()
        request = urllib.request.Request(url, data=data, method=method, headers={
            'Authorization': 'Bearer ' + access_token, 'Content-Type': 'application/json'})
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.load(response)

    def current_main():
        # Public GitHub lookup receives no Google access token or stored GitHub token.
        request = urllib.request.Request(
            'https://api.github.com/repos/yuzhu9387/socrates./git/ref/heads/main',
            headers={'Accept': 'application/vnd.github+json', 'User-Agent': 'socrates-github-deploy',
                     'X-GitHub-Api-Version': '2022-11-28'})
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)['object']['sha']

    # Workflow concurrency serializes runs. The watermark also rejects reruns of
    # older run IDs; ETags protect against overlapping manual service updates.
    deadline = time.monotonic() + 300
    operation = None
    while time.monotonic() < deadline:
        current = cloud_request(service_url)
        labels = dict(current.get('labels', {}))
        previous = labels.get('socrates-github-order', '')
        if previous and not re.fullmatch(r'[0-9]{26}', previous):
            raise RuntimeError('The existing GitHub deployment watermark is invalid.')
        if previous > order:
            print('Deployment skipped: a newer GitHub run already updated the service.')
            return
        if current.get('reconciling'):
            time.sleep(3)
            continue
        # Every API error, including GitHub 404/429, stops deployment.
        if current_main() != commit:
            print('Deployment skipped: this commit is no longer GitHub main.')
            return
        containers = copy.deepcopy(current['template']['containers'])
        ingress = [container for container in containers if any(port.get('containerPort') == 3001 for port in container.get('ports', []))]
        if len(ingress) != 1 or not current.get('etag'):
            raise RuntimeError('Expected one existing ingress container on port 3001 and the service ETag.')
        ingress[0]['image'] = image_digest
        labels.update({'socrates-github-order': order, 'socrates-commit': commit})
        payload = {'name': name, 'etag': current['etag'], 'labels': labels,
                   'template': {'containers': containers}}
        try:
            operation = cloud_request(service_url + '?updateMask=template.containers,labels&allowMissing=false',
                                      'PATCH', payload)
            break
        except urllib.error.HTTPError as error:
            if error.code not in (409, 412):
                raise
            # Re-read the service and repeat the main-HEAD gate before retrying.
            time.sleep(3)
    if operation is None:
        raise RuntimeError('Deployment could not acquire a current service version within five minutes.')

    deadline = time.monotonic() + 600
    while not operation.get('done') and time.monotonic() < deadline:
        time.sleep(3)
        operation = cloud_request('https://run.googleapis.com/v2/' + operation['name'])
    if not operation.get('done') or operation.get('error'):
        raise RuntimeError('Cloud Run did not complete the image update successfully.')
    deployed = operation.get('response', {})
    if deployed.get('terminalCondition', {}).get('state') != 'CONDITION_SUCCEEDED':
        raise RuntimeError('Cloud Run revision did not become ready.')
    print(f'Deployed {commit} as {image_digest}')


if __name__ == '__main__':
    main()
