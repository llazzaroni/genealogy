(function() {
  function getQueryParam(name) {
    var params = new URLSearchParams(window.location.search || '');
    if (!params.has(name)) return null;
    return params.get(name);
  }

  function flagEnabled(name) {
    var value = getQueryParam(name);
    if (value === null) return false;
    value = String(value).toLowerCase();
    if (value === '0' || value === 'false' || value === 'no') return false;
    return true;
  }

  function toNumber(value) {
    if (value === null || value === undefined) return null;
    var n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function init() {
    if (!window.nodes || !window.edges || !window.network) {
      setTimeout(init, 50);
      return;
    }

    if (window.ancestorLayoutEnabled === false) return;
    if (window.ancestorLayoutEnabled !== true) {
      if (!flagEnabled('ancestors') && getQueryParam('layout') !== 'ancestors') {
        return;
      }
    }

    var rootParam = getQueryParam('root');
    var root = (typeof window.ancestorLayoutRoot === 'number')
      ? window.ancestorLayoutRoot
      : toNumber(rootParam);
    if (!Number.isFinite(root)) return;

    var vscale = toNumber(getQueryParam('vscale'));
    var hscale = toNumber(getQueryParam('hscale'));
    if (!Number.isFinite(vscale) && typeof window.ancestorLayoutVScale === 'number') {
      vscale = window.ancestorLayoutVScale;
    }
    if (!Number.isFinite(hscale) && typeof window.ancestorLayoutHScale === 'number') {
      hscale = window.ancestorLayoutHScale;
    }
    if (!Number.isFinite(vscale)) vscale = 400;
    if (!Number.isFinite(hscale)) hscale = 400;

    var fathers = {};
    var mothers = {};
    edges.get().forEach(function(edge) {
      if (!edge) return;
      var parent = edge.from;
      var child = edge.to;
      if (parent === undefined || child === undefined) return;
      if (edge.title === 'father') {
        fathers[child] = parent;
      } else if (edge.title === 'mother') {
        mothers[child] = parent;
      }
    });

    var pos = {};
    var rows = {};

    function place(node, x, y) {
      if (Object.prototype.hasOwnProperty.call(pos, node)) return;
      pos[node] = { x: x, y: y };
      if (!rows[y]) rows[y] = [];
      rows[y].push(node);
    }

    function walk(node) {
      var p = pos[node];
      if (!p) return;
      var x = p.x;
      var y = p.y;

      var father = fathers[node];
      if (father !== undefined && !Object.prototype.hasOwnProperty.call(pos, father)) {
        place(father, x, y + 1);
        walk(father);
      }

      var mother = mothers[node];
      if (mother !== undefined && !Object.prototype.hasOwnProperty.call(pos, mother)) {
        place(mother, x + 1, y + 1);
        walk(mother);
      }
    }

    place(root, 0, 0);
    walk(root);

    var rowKeys = Object.keys(rows);
    if (!rowKeys.length) return;

    var maxLen = 1;
    rowKeys.forEach(function(key) {
      var n = rows[key].length;
      if (n > maxLen) maxLen = n;
    });
    var width = maxLen * hscale;

    var updates = [];
    var posSet = {};
    var minX = null;
    var maxX = null;
    var minY = null;
    var maxY = null;
    rowKeys.forEach(function(key) {
      var nodesInRow = rows[key];
      for (var i = 0; i < nodesInRow.length; i += 1) {
        posSet[nodesInRow[i]] = true;
      }
    });
    rowKeys.forEach(function(key) {
      var y = Number(key);
      var nodesInRow = rows[key];
      var n = nodesInRow.length;
      if (!n) return;
      var spacing = width / (n + 1);
      for (var i = 0; i < n; i += 1) {
        var id = nodesInRow[i];
        var x = spacing * (i + 1);
        var yPos = -y * vscale;
        updates.push({
          id: id,
          x: x,
          y: yPos,
          fixed: { x: true, y: true },
          hidden: false
        });
        if (minX === null || x < minX) minX = x;
        if (maxX === null || x > maxX) maxX = x;
        if (minY === null || yPos < minY) minY = yPos;
        if (maxY === null || yPos > maxY) maxY = yPos;
      }
    });

    if (updates.length) nodes.update(updates);

    var removeNodeIds = nodes.get({
      filter: function(node) {
        return !posSet[node.id];
      }
    }).map(function(node) {
      return node.id;
    });
    if (removeNodeIds.length) nodes.remove(removeNodeIds);

    var removeEdgeIds = edges.get({
      filter: function(edge) {
        return !(posSet[edge.from] && posSet[edge.to]);
      }
    }).map(function(edge) {
      return edge.id;
    });
    if (removeEdgeIds.length) edges.remove(removeEdgeIds);
    window.ancestorLayoutApplied = true;
    network.setOptions({ physics: { enabled: false }, edges: { smooth: false } });
    if (minX !== null && minY !== null) {
      var cx = (minX + maxX) / 2;
      var cy = (minY + maxY) / 2;
      network.moveTo({ position: { x: cx, y: cy }, scale: 1, animation: false });
    }

  }

  init();
})();
