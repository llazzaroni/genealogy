(function() {
  function init() {
    if (!window.network || !window.edges) {
      setTimeout(init, 50);
      return;
    }

    var edgeColors = {};

    function cacheCurrentEdgeColors() {
      edgeColors = {};
      edges.get().forEach(function(edge) {
        edgeColors[edge.id] = edge.color || null;
      });
    }

    function resetEdges() {
      var updates = [];
      edges.get().forEach(function(edge) {
        var original = edgeColors[edge.id];
        if (original) {
          updates.push({ id: edge.id, color: original });
        } else {
          updates.push({ id: edge.id, color: { inherit: true } });
        }
      });
      if (updates.length) edges.update(updates);
    }

    function highlightEdges(nodeIds) {
      resetEdges();
      var connected = new Set();
      nodeIds.forEach(function(id) {
        (network.getConnectedEdges(id) || []).forEach(function(edgeId) {
          connected.add(edgeId);
        });
      });
      if (!connected.size) return;
      var updates = [];
      connected.forEach(function(edgeId) {
        updates.push({ id: edgeId, color: { color: 'red', highlight: 'red' } });
      });
      edges.update(updates);
    }

    window.refreshEdgeHighlightBaseColors = function(options) {
      cacheCurrentEdgeColors();
      if (!options || options.reset !== false) {
        resetEdges();
      }
    };

    cacheCurrentEdgeColors();

    network.on('selectNode', function(params) {
      highlightEdges(params.nodes || []);
    });

    network.on('deselectNode', function() {
      resetEdges();
    });
  }

  init();
})();
