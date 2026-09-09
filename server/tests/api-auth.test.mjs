import test from 'node:test';
import assert from 'node:assert/strict';

test('password hashing uses independent salted scrypt hashes and safe verification',async()=>{
 const {hashPassword,verifyPassword}=await import('../src/auth.mjs');
 const first=await hashPassword('密码 and twelve words');const second=await hashPassword('密码 and twelve words');
 assert.notEqual(first,second);assert.match(first,/^scrypt\$/);assert.equal(await verifyPassword('密码 and twelve words',first),true);assert.equal(await verifyPassword('incorrect password',first),false);assert.equal(await verifyPassword('bad','broken'),false);
});
