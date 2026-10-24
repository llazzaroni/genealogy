(function() {
  function createSearchPanel() {
    var panel = document.createElement('div');
    panel.id = 'search-panel';
    panel.style.position = 'fixed';
    panel.style.top = '10px';
    panel.style.left = '10px';
    panel.style.zIndex = '9999';
    panel.style.background = 'rgba(255,255,255,0.9)';
    panel.style.padding = '8px 10px';
    panel.style.border = '1px solid #ccc';
    panel.style.borderRadius = '4px';
    panel.style.fontFamily = 'Arial, sans-serif';
    panel.style.boxShadow = '0 2px 6px rgba(0,0,0,0.15)';

    var label = document.createElement('label');
    label.htmlFor = 'node-search';
    label.textContent = 'Search node:';
    label.style.fontSize = '13px';

    var input = document.createElement('input');
    input.id = 'node-search';
    input.type = 'text';
    input.placeholder = 'Type name or id';
    input.style.margin = '0 6px';
    input.style.padding = '4px 6px';
    input.style.fontSize = '13px';

    var goBtn = document.createElement('button');
    goBtn.id = 'node-search-btn';
    goBtn.textContent = 'Go';
    goBtn.style.padding = '4px 8px';
    goBtn.style.fontSize = '13px';

    var upBtn = document.createElement('button');
    upBtn.id = 'node-prev-btn';
    upBtn.textContent = 'Up';
    upBtn.style.padding = '4px 8px';
    upBtn.style.fontSize = '13px';

    var downBtn = document.createElement('button');
    downBtn.id = 'node-next-btn';
    downBtn.textContent = 'Down';
    downBtn.style.padding = '4px 8px';
    downBtn.style.fontSize = '13px';

    var countSpan = document.createElement('span');
    countSpan.id = 'node-match-count';
    countSpan.style.marginLeft = '8px';
    countSpan.style.fontSize = '12px';
    countSpan.style.color = '#333';

    panel.appendChild(label);
    panel.appendChild(input);
    panel.appendChild(goBtn);
    panel.appendChild(upBtn);
    panel.appendChild(downBtn);
    panel.appendChild(countSpan);

    document.body.appendChild(panel);
  }

  function init() {
    if (!window.network || !window.nodes) {
      setTimeout(init, 50);
      return;
    }

    if (!document.getElementById('search-panel')) {
      createSearchPanel();
    }

    var input = document.getElementById('node-search');
    var btn = document.getElementById('node-search-btn');
    var prevBtn = document.getElementById('node-prev-btn');
    var nextBtn = document.getElementById('node-next-btn');
    var countSpan = document.getElementById('node-match-count');
    if (!input || !btn || !prevBtn || !nextBtn || !countSpan) return;

    var matchList = [];
    var matchIndex = 0;
    var lastQuery = '';

    function normalize(text) {
      return String(text || '').trim().toLowerCase();
    }

    function collectExactMatches(query) {
      var q = normalize(query);
      if (!q) return [];
      return nodes.get({
        filter: function(item) {
          return normalize(item.label) === q || normalize(item.id) === q;
        }
      });
    }

    function collectPartialMatches(query) {
      var q = normalize(query);
      if (!q) return [];
      return nodes.get({
        filter: function(item) {
          return (String(item.label || '') + String(item.id || '')).toLowerCase().indexOf(q) !== -1;
        }
      });
    }

    function focusMatch() {
      if (!matchList.length) return;
      var node = matchList[matchIndex % matchList.length];
      network.selectNodes([node.id]);
      network.focus(node.id, { scale: 1.2, animation: true });
    }

    function updateMatchCount(query) {
      var q = normalize(query);
      if (!q) {
        countSpan.textContent = '';
        return;
      }
      var exacts = collectExactMatches(q);
      if (exacts.length) {
        countSpan.textContent = 'Exact matches: ' + exacts.length;
        return;
      }
      var partials = collectPartialMatches(q);
      countSpan.textContent = 'Matches: ' + partials.length;
    }

    function doSearch() {
      var q = normalize(input.value);
      if (!q) {
        matchList = [];
        matchIndex = 0;
        lastQuery = '';
        countSpan.textContent = '';
        network.unselectAll();
        network.fit({ animation: true });
        return;
      }
      var exacts = collectExactMatches(q);
      matchIndex = 0;
      lastQuery = q;
      if (exacts.length) {
        matchList = exacts;
        updateMatchCount(q);
        focusMatch();
        return;
      }
      var partials = collectPartialMatches(q);
      if (!partials.length) return;
      matchList = partials;
      updateMatchCount(q);
      focusMatch();
    }

    btn.addEventListener('click', doSearch);
    prevBtn.addEventListener('click', function() {
      var q = normalize(input.value);
      if (q !== lastQuery) {
        var exacts = collectExactMatches(q);
        matchIndex = 0;
        lastQuery = q;
        matchList = exacts.length ? exacts : collectPartialMatches(q);
      }
      if (!matchList.length) return;
      matchIndex = (matchIndex - 1 + matchList.length) % matchList.length;
      focusMatch();
    });
    nextBtn.addEventListener('click', function() {
      var q = normalize(input.value);
      if (q !== lastQuery) {
        var exacts = collectExactMatches(q);
        matchIndex = 0;
        lastQuery = q;
        matchList = exacts.length ? exacts : collectPartialMatches(q);
        updateMatchCount(q);
      }
      if (!matchList.length) return;
      matchIndex = (matchIndex + 1) % matchList.length;
      focusMatch();
    });
    input.addEventListener('keyup', function(e) {
      if (e.key === 'Enter') doSearch();
    });
    input.addEventListener('input', function() {
      updateMatchCount(input.value);
    });
  }

  init();
})();
