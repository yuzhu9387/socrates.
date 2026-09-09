import React from 'react';

/** A question that becomes a connection: the notebook's smallest unit of insight. */
export default function SocratesMark({className=''}){
 return <svg className={`socrates-mark ${className}`} viewBox="0 0 40 44" fill="none" aria-hidden="true" focusable="false">
  <path d="M8 14C8 7.4 13.4 4 20 4C27.3 4 32 8.3 32 14.5C32 23.4 18 23 18 31" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
  <circle cx="8" cy="14" r="3" fill="currentColor"/>
  <circle cx="31.8" cy="15" r="3.7" fill="var(--sidebar, #fff)" stroke="currentColor" strokeWidth="2"/>
  <circle cx="18" cy="38" r="3" fill="currentColor"/>
 </svg>;
}
