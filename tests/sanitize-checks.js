/* Runs inside tests/sanitize.html. Lives in its own file because several
   test strings contain closing script tags, which would end an inline
   script element early. */
(async () => {
  const out = document.getElementById('out');
  let passed = 0, failed = 0;
  const log = (ok, name, detail = '') => { (ok ? passed++ : failed++); out.textContent += `${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ->  ' + detail : ''}\n`; };
  const expect = (name, html, test) => { const got = sanitizeHtml(html); log(test(got), name, got.slice(0, 160)); };
  const lacks = (...needles) => (got) => needles.every(n => !got.toLowerCase().includes(n.toLowerCase()));
  const has = (...needles) => (got) => needles.every(n => got.includes(n));

  expect('script tags vanish', '<p>hi</p><script>window.__pwned=1</script>', lacks('<script'));
  expect('event handlers are stripped', '<img src="x" onerror="window.__pwned=1">', lacks('onerror'));
  expect('javascript: links are dropped', '<a href="javascript:window.__pwned=1">x</a>', lacks('href'));
  expect('javascript: with control characters is dropped', '<a href="java\tscript:alert(1)">x</a>', lacks('href'));
  expect('https links are kept and get rel', '<a href="https://example.com/x">x</a>', has('href="https://example.com/x"', 'rel="noopener noreferrer nofollow"'));
  expect('mailto links are kept', '<a href="mailto:a@b.co">x</a>', has('href="mailto:a@b.co"'));
  expect('relative links are dropped', '<a href="/settings">x</a>', lacks('href'));
  expect('data:text/html images are dropped', '<img src="data:text/html;base64,PHNjcmlwdD4=">', lacks('src'));
  expect('data:image/png images are kept', '<img src="data:image/png;base64,iVBORw0KGgo=" width="20">', has('src="data:image/png;base64,iVBORw0KGgo="', 'width="20"'));
  expect('svg is dropped whole', '<svg><script>window.__pwned=1</script><a xlink:href="javascript:1">x</a></svg><p>after</p>', (g) => lacks('<svg', 'script')(g) && has('after')(g));
  expect('math is dropped whole', '<math><mi xlink:href="data:x">t</mi></math>ok', (g) => lacks('<math')(g) && has('ok')(g));
  expect('iframes and objects are dropped', '<iframe src="https://x"></iframe><object data="x"></object><embed src="x">z', (g) => lacks('<iframe', '<object', '<embed')(g) && has('z')(g));
  expect('style blocks are dropped', '<style>body{display:none}</style><p>t</p>', lacks('<style', 'display'));
  expect('url() in inline styles is dropped', '<span style="background-image:url(javascript:1);color:red">t</span>', (g) => lacks('url(')(g) && has('color: red')(g));
  expect('allowed inline styles are kept', '<span style="background-color: rgb(255, 235, 59); font-weight: bold">t</span>', has('background-color: rgb(255, 235, 59)', 'font-weight: bold'));
  expect('position and other styles are dropped', '<div style="position:fixed;top:0;left:0;width:100vw;height:100vh;background:#fff">t</div>', lacks('position', 'width'));
  expect('nb- classes survive, others do not', '<div class="nb-todo-line other-class"><input type="checkbox" checked>&nbsp;task</div>', (g) => has('class="nb-todo-line"', 'type="checkbox"', 'checked')(g) && lacks('other-class')(g));
  expect('non-checkbox inputs are dropped', '<input type="text" value="x"><input type="image" src="x" onerror="1">', lacks('<input'));
  expect('unknown wrappers keep their text', '<section><article><custom-el>kept</custom-el></article></section>', (g) => has('kept')(g) && lacks('<section', '<custom-el')(g));
  expect('forms and buttons are dropped', '<form action="https://evil"><button formaction="javascript:1">go</button></form>after', (g) => lacks('<form', '<button', 'formaction')(g) && has('after')(g));
  expect('noscript tricks are dropped whole', '<noscript><p title="</noscript><img src=x onerror=window.__pwned=1>"></noscript>', lacks('onerror', 'noscript'));
  expect('template content is dropped', '<template><img src=x onerror=window.__pwned=1></template>t', lacks('onerror', 'template'));
  expect('editor headings, lists, quotes, code and rules survive', '<h1>a</h1><h3>b</h3><ul><li>c</li></ul><ol><li>d</li></ol><blockquote>e</blockquote><pre>f</pre><hr><p><br></p>', has('<h1>a</h1>', '<h3>b</h3>', '<ul><li>c</li></ul>', '<ol><li>d</li></ol>', '<blockquote>e</blockquote>', '<pre>f</pre>', '<hr>'));
  expect('font tags from execCommand survive with safe attributes', '<font face="Georgia" size="4" color="#ff0000" onclick="1">t</font>', (g) => has('face="Georgia"', 'size="4"', 'color="#ff0000"')(g) && lacks('onclick')(g));
  expect('tables survive', '<table><tbody><tr><td colspan="2">x</td></tr></tbody></table>', has('<table>', 'colspan="2"'));
  expect('id, name and target attributes are dropped', '<a id="x" name="y" target="_top" href="https://e.com">t</a>', (g) => lacks('id=', 'name=', '_top')(g) && has('target="_blank"')(g));
  expect('deeply nested markup does not hang', '<div>'.repeat(200) + 'deep' + '</div>'.repeat(200), () => true);
  log(typeof textOfHtml === 'function' && textOfHtml('<p>a <b>b</b></p><img src=x onerror="window.__pwned=1">') === 'a b', 'textOfHtml returns text only');

  // Render a hostile note the way the notebook does and see whether anything ran.
  const hostile = '<img src=x onerror="window.__pwned=1"><svg onload="window.__pwned=2"></svg><a href="javascript:window.__pwned=3">l</a><iframe srcdoc="<script>parent.__pwned=4</script>"></iframe>';
  document.getElementById('live').innerHTML = sanitizeHtml(hostile);
  await new Promise(r => setTimeout(r, 400));
  log(window.__pwned === undefined, 'nothing executed after rendering a hostile note', String(window.__pwned));

  document.title = `${failed ? 'FAIL' : 'PASS'}: ${passed} passed, ${failed} failed`;
  out.textContent += `\n${passed} passed, ${failed} failed\n`;
})();
