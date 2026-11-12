// 화면 크기 진단. 주소 끝에 ?debugvp 를 붙여 열면 브라우저가 알려 주는 화면 높이 값을 표시한다.
// 모바일 브라우저에서 화면 아래쪽에 빈 띠가 생길 때 원인을 찾는 데 쓴다.
(function () {
  if (location.search.indexOf('debugvp') < 0) return;
  window.addEventListener('load', function () {
    var box = document.createElement('div');
    box.style.cssText =
      'position:fixed;left:8px;top:60px;z-index:99999;background:rgba(0,0,0,.82);color:#fff;' +
      'font:12px/1.5 monospace;padding:8px 10px;border-radius:8px;white-space:pre;pointer-events:none';
    var probe = document.createElement('div');
    probe.style.cssText =
      'position:fixed;left:0;bottom:0;width:0;height:0;' +
      'padding-bottom:env(safe-area-inset-bottom);padding-top:env(safe-area-inset-top)';
    // 화면 맨 아래에 붙는 빨간 선: 이 선 아래로 무엇이 보이는지로 여백의 주인을 가린다
    var line = document.createElement('div');
    line.style.cssText =
      'position:fixed;left:0;right:0;bottom:0;height:2px;background:red;z-index:99999;pointer-events:none';
    document.documentElement.appendChild(probe);
    document.documentElement.appendChild(line);
    document.documentElement.appendChild(box);
    function px(n) { return Math.round(n * 10) / 10; }
    function update() {
      var vv = window.visualViewport;
      var fv = document.querySelector('flutter-view');
      var cs = getComputedStyle(probe);
      var fr = fv ? fv.getBoundingClientRect() : null;
      var br = document.body.getBoundingClientRect();
      var ua = navigator.userAgent;
      var lines = [
        'innerH        ' + px(window.innerHeight),
        'visualVP.h    ' + (vv ? px(vv.height) + ' top ' + px(vv.offsetTop) : '-'),
        'docEl.clientH ' + px(document.documentElement.clientHeight),
        'body.h        ' + px(br.height),
        'flutter.h     ' + (fr ? px(fr.height) + ' bottom ' + px(fr.bottom) : '-'),
        'screen.h      ' + screen.height + ' avail ' + screen.availHeight,
        'safe bottom   ' + cs.paddingBottom + ' top ' + cs.paddingTop,
        'dpr ' + window.devicePixelRatio + ' standalone ' +
          window.matchMedia('(display-mode: standalone)').matches,
        ua.slice(ua.lastIndexOf(')') + 1).trim().slice(0, 44),
      ];
      box.textContent = lines.join(String.fromCharCode(10));
    }
    setInterval(update, 500);
    update();
  });
})();
