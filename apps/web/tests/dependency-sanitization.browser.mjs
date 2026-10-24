import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {after,before,test} from 'node:test';
import {chromium} from 'playwright';

const require=createRequire(import.meta.url);
let browser;
before(async()=>{browser=await chromium.launch({headless:true});});
after(async()=>{await browser?.close();});

// These opt-in DOM modes are upstream regressions; Oddpath uses default string output.
test('sanitizer neutralizes a subtree detached by a hook',{timeout:15000},async()=>{
  const page=await browser.newPage();
  try{
    await page.route('**/*',route=>route.abort());
    await page.addScriptTag({path:join(dirname(require.resolve('dompurify')),'purify.js')});
    const handlers=await page.evaluate(()=>['parent','nextSibling'].map(mode=>{
      const purifier=DOMPurify(window),root=document.createElement('div');
      root.innerHTML='<figure><img class="bad"><img id="evil" onerror="window.untrusted=true"></figure><p>ok</p>';
      const evil=root.querySelector('#evil');
      purifier.addHook('afterSanitizeAttributes',node=>{
        if(node.getAttribute?.('class')==='bad'){
          if(mode==='parent')node.parentNode.remove();
          else node.nextElementSibling.remove();
        }
      });
      purifier.sanitize(root,{IN_PLACE:true});
      return evil.getAttribute('onerror');
    }));
    assert.deepEqual(handlers,[null,null]);
  }finally{await page.close();}
});

test('template mode scrubs expressions assembled inside attached shadow roots',{timeout:15000},async()=>{
  const page=await browser.newPage();
  try{
    await page.addScriptTag({path:join(dirname(require.resolve('dompurify')),'purify.js')});
    const text=await page.evaluate(()=>{
      const host=document.createElement('div'),shadow=host.attachShadow({mode:'open'});
      shadow.append(document.createTextNode('$'),document.createElement('object'),document.createTextNode('{untrusted()}'));
      DOMPurify.sanitize(host,{IN_PLACE:true,SAFE_FOR_TEMPLATES:true});
      return shadow.textContent;
    });
    assert.equal(text.includes('${untrusted()}'),false);
  }finally{await page.close();}
});

test('default string output preserves safe markup and removes executable markup',{timeout:15000},async()=>{
  const page=await browser.newPage();
  try{
    await page.addScriptTag({path:join(dirname(require.resolve('dompurify')),'purify.js')});
    const output=await page.evaluate(()=>DOMPurify.sanitize('<p><strong>Safe</strong><img onerror="untrusted()"><a href="javascript:untrusted()">link</a><script>untrusted()</script></p>'));
    assert.match(output,/<strong>Safe<\/strong>/);
    assert.doesNotMatch(output,/onerror|javascript:|<script/i);
  }finally{await page.close();}
});
