(function() {
  function init() {
    if (!window.network || !window.nodes || !window.edges) {
      setTimeout(init, 50);
      return;
    }

    var dynasties = Array.isArray(window.graphDynasties) ? window.graphDynasties.slice() : [];
    var dynastyEdges = Array.isArray(window.graphDynastyEdges) ? window.graphDynastyEdges.slice() : [];
    var regionCatalog = window.graphRegionCatalog && typeof window.graphRegionCatalog === 'object'
      ? window.graphRegionCatalog
      : {};
    if (!dynasties.length) {
      return;
    }

    var state = {
      mode: 'overview',
      selectedDynastyId: 'all',
      activePatrilineRootId: null,
      selectedPersonId: null,
      activeRegionMapNodeId: null,
      activeOverviewDynastyId: null,
      overviewMap: null,
      dynastyLayoutMode: 'genealogical',
      showMinorNodes: false,
      showMaternalBridges: true,
      expandedAncestorRoots: {}
    };
    var historyStack = [];
    var forwardHistoryStack = [];
    var manualNodePositionsByContext = {};
    var suppressSelectionNavigation = false;
    var overviewTransitioning = false;
    var pendingOverviewClickTimer = null;
    var persistedDynastyLayoutMode = 'genealogical';

    var originalNodes = nodes.get().map(function(node) {
      return Object.assign({}, node);
    });
    var originalEdges = edges.get().map(function(edge) {
      return Object.assign({}, edge);
    });
    // The overview does not require person-level graph data.  When graph.html
    // is rendered in lazy mode, load that data only when a dynasty is opened.
    var fullGraphReady = originalNodes.length > 0;
    var fullGraphLoadPromise = null;
    var personNodeById = {};
    var dynastyById = {};
    var neighborsByNode = {};
    var fatherByChild = {};
    var parentEdgesByChild = {};
    var hoverNodeId = null;
    var hoverPanelHideTimer = null;
  var IBERIA_VECTOR_URL = window.graphRegionMapSvg || '/data/maps/regions.svg';
    var REGION_DATA_URL = window.graphRegionDataUrl || null;
    var DYNASTY_DATA_URL = window.graphDynastyDataUrl || null;
    var PARENT_DATA_URL = window.graphParentDataUrl || null;
    var GRAPH_DATA_VERSION = window.graphDataVersion || '';
    var REGION_DATA_BUCKET_COUNT = 256;
    var regionDataBucketPromises = {};
    var loadedDynastyId = null;
    var dynastyGraphLoadPromise = null;
    var parentDataBuckets = {};
    var parentDataRecords = {};
    var OVERVIEW_MAP_URLS = window.graphOverviewMapSvgs || {
      Europe: window.graphEuropeBackgroundSvg || null,
      Asia: null,
      'Greek Mythology': null,
      Antiquity: null
    };
    var OVERVIEW_MAP_WIDTH = 1401;
    var OVERVIEW_MAP_HEIGHT = 1198;
    // The Mediterranean SVG has a 2432 x 1448 viewBox. Keep its native
    // aspect ratio instead of stretching it into the Europe-sized viewport.
    var OVERVIEW_MAP_DIMENSIONS = {
      Antiquity: { width: 2012, height: 1198 }
    };
    // Atlas node scales. Adjust these values to tune the coat-of-arms dots
    // and labels without changing their geographic positions.
    var OVERVIEW_MARKER_SCALES = {
      Europe: { image: 3, dot: 2.5, font: 1.5, vadjust: -3 },
      Asia: { image: 4.5, dot: 3.75, font: 2.25, vadjust: -3.5 },
      'Greek Mythology': { image: 7, dot: 4.5, font: 4, vadjust: -4 },
      Antiquity: { image: 20, dot: 3.75, font: 10, vadjust: -3.5 }
    };
    var DEG_TO_RAD = Math.PI / 180;
    var overviewMapImage = new Image();
    var overviewMapReady = false;
    var OVERVIEW_TOP_EDGE_COUNT = 50;
    var iberiaVectorText = null;
    var iberiaVectorReady = false;
    var pendingRegionMapNodeId = null;
    var activeRegionMapView = null;
    var regionMapRenderCache = {};
    var activeOverviewEdgeTooltipId = null;
    var activeOverviewEdgeId = null;
    var regionCatalogById = {};
    var allRegionColors = {};
    var regionColorAliases = {
      '#4EBE4A': '#4FBF4B',
      '#EE57DF': '#EF58E0'
    };

    function activeOverviewMapDimensions() {
      return OVERVIEW_MAP_DIMENSIONS[state.overviewMap] || {
        width: OVERVIEW_MAP_WIDTH,
        height: OVERVIEW_MAP_HEIGHT
      };
    }

    function showLazyDiagnostic(message, isError) {
      var panel = document.getElementById('lazy-graph-diagnostic');
      if (!panel) {
        panel = document.createElement('div');
        panel.id = 'lazy-graph-diagnostic';
        panel.style.position = 'fixed';
        panel.style.left = '16px';
        panel.style.bottom = '16px';
        panel.style.zIndex = '10060';
        panel.style.maxWidth = 'min(720px, calc(100vw - 32px))';
        panel.style.padding = '10px 12px';
        panel.style.borderRadius = '6px';
        panel.style.font = '12px/1.4 Menlo, Monaco, monospace';
        panel.style.whiteSpace = 'pre-wrap';
        panel.style.boxShadow = '0 2px 10px rgba(0,0,0,0.22)';
        document.body.appendChild(panel);
      }
      panel.style.display = 'block';
      panel.style.color = isError ? '#7f1d1d' : '#0f172a';
      panel.style.background = isError ? 'rgba(254,226,226,0.97)' : 'rgba(219,234,254,0.97)';
      panel.style.border = '1px solid ' + (isError ? '#ef4444' : '#3b82f6');
      panel.textContent = message;
    }

    function hideLazyDiagnostic() {
      var panel = document.getElementById('lazy-graph-diagnostic');
      if (panel) panel.style.display = 'none';
    }

    function normalizeHexColor(value) {
      if (!value && value !== 0) return null;
      var text = String(value).trim();
      if (!text) return null;
      if (text.charAt(0) !== '#') text = '#' + text;
      if (!/^#[0-9a-fA-F]{6}$/.test(text)) return null;
      return text.toUpperCase();
    }

    function canonicalRegionColor(value) {
      var normalized = normalizeHexColor(value);
      if (!normalized) return null;
      return regionColorAliases[normalized] || normalized;
    }

    Object.keys(regionCatalog).forEach(function(regionId) {
      var entry = regionCatalog[regionId] || {};
      var color = normalizeHexColor(entry.color);
      regionCatalogById[String(regionId)] = {
        name: entry.name || ('Region ' + regionId),
        color: color
      };
      if (color) {
        allRegionColors[color] = true;
      }
    });

    overviewMapImage.onload = function() {
      overviewMapReady = true;
      if (window.network && typeof window.network.redraw === 'function') {
        window.network.redraw();
      }
    };
    function normalizeOverviewMap(value) {
      var text = String(value || '').trim().toLowerCase();
      if (text === 'europe') return 'Europe';
      if (text === 'asia') return 'Asia';
      if (text === 'greek mythology' || text === 'greece') return 'Greek Mythology';
      if (text === 'antiquity') return 'Antiquity';
      return null;
    }

    function setOverviewMap(mapName) {
      state.overviewMap = normalizeOverviewMap(mapName);
      overviewMapReady = false;
      var url = state.overviewMap ? OVERVIEW_MAP_URLS[state.overviewMap] : null;
      if (url) overviewMapImage.src = url;
    }

    function clampNumber(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }

    function projectLonLatToOverview(lon, lat) {
      var latRad = lat * DEG_TO_RAD;
      var deltaLonRad = (lon - 10) * DEG_TO_RAD;
      var common = Math.pow(
        (
          1 +
          Math.sin(latRad) * Math.sin(52 * DEG_TO_RAD) +
          Math.cos(latRad) * Math.cos(52 * DEG_TO_RAD) * Math.cos(deltaLonRad)
        ) * 0.5,
        -0.5
      );
      var xPercent = 131.579 * (Math.cos(latRad) * Math.sin(deltaLonRad)) * common + 36.388;
      var yPercent = 55.11 - 153.610 * (
        Math.cos(52 * DEG_TO_RAD) * Math.sin(latRad) -
        Math.sin(52 * DEG_TO_RAD) * Math.cos(latRad) * Math.cos(deltaLonRad)
      ) * common;
      var xNorm = clampNumber(xPercent / 100, 0, 1);
      var yNorm = clampNumber(yPercent / 100, 0, 1);
      return {
        x: (xNorm - 0.5) * OVERVIEW_MAP_WIDTH,
        y: (yNorm - 0.5) * OVERVIEW_MAP_HEIGHT
      };
    }

    function relaxPositionedItems(items, minSeparation) {
      if (!items || items.length < 2) return;
      for (var relaxStep = 0; relaxStep < 8; relaxStep += 1) {
        for (var i = 0; i < items.length; i += 1) {
          for (var j = i + 1; j < items.length; j += 1) {
            var itemA = items[i];
            var itemB = items[j];
            var deltaX = itemB.x - itemA.x;
            var deltaY = itemB.y - itemA.y;
            var distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
            if (distance >= minSeparation) continue;
            if (distance < 1e-6) {
              var seedA = Number(itemA.entry && itemA.entry.birth_year_estimate) || Number(itemA.node && itemA.node.id) || (i + 1);
              var seedB = Number(itemB.entry && itemB.entry.birth_year_estimate) || Number(itemB.node && itemB.node.id) || (j + 1);
              var angle = (seedA * 0.13 + seedB * 0.07 + i + j + 1) * 0.61803398875;
              deltaX = Math.cos(angle);
              deltaY = Math.sin(angle);
              distance = 1;
            }
            var overlap = (minSeparation - distance) * 0.62;
            var unitX = deltaX / distance;
            var unitY = deltaY / distance;
            itemA.x -= unitX * overlap;
            itemA.y -= unitY * overlap;
            itemB.x += unitX * overlap;
            itemB.y += unitY * overlap;
          }
        }
      }
    }

    fetch(IBERIA_VECTOR_URL)
      .then(function(response) {
        if (!response.ok) throw new Error('Failed to load vector map');
        return response.text();
      })
      .then(function(svgText) {
        iberiaVectorText = svgText;
        iberiaVectorReady = true;
        if (pendingRegionMapNodeId != null) {
          var nodeId = pendingRegionMapNodeId;
          pendingRegionMapNodeId = null;
          openRegionMapForNode(nodeId);
        }
      })
      .catch(function() {
        iberiaVectorText = null;
        iberiaVectorReady = false;
      });

    function rebuildGraphIndexes() {
      personNodeById = {};
      dynastyById = {};
      neighborsByNode = {};
      fatherByChild = {};
      parentEdgesByChild = {};

      originalNodes.forEach(function(node) {
        personNodeById[String(node.id)] = node;
      });
      dynasties.forEach(function(dynasty) {
        dynastyById[String(dynasty.dynasty_id)] = dynasty;
      });
      originalEdges.forEach(function(edge) {
        var fromId = String(edge.from);
        var toId = String(edge.to);
        if (!neighborsByNode[fromId]) neighborsByNode[fromId] = new Set();
        if (!neighborsByNode[toId]) neighborsByNode[toId] = new Set();
        neighborsByNode[fromId].add(toId);
        neighborsByNode[toId].add(fromId);
        var relation = edge.relation || edge.title || '';
        if (!parentEdgesByChild[toId]) parentEdgesByChild[toId] = [];
        parentEdgesByChild[toId].push({
          from: fromId,
          to: toId,
          relation: relation
        });
        if ((relation === 'father' || relation === 'father_mother') && !fatherByChild[toId]) {
          fatherByChild[toId] = fromId;
        }
      });
    }

    function regionDistributionByNode(data) {
      var distributions = {};
      var categories = Array.isArray(data.region_categories) ? data.region_categories : [];
      (Array.isArray(data.region_entries) ? data.region_entries : []).forEach(function(entry) {
        if (!Array.isArray(entry) || entry.length < 3) return;
        var nodeId = String(entry[0]);
        var category = categories[Number(entry[1])];
        var value = Number(entry[2]);
        if (category == null || !isFinite(value)) return;
        if (!distributions[nodeId]) distributions[nodeId] = {};
        distributions[nodeId][String(category)] = value;
      });
      return distributions;
    }

    function tooltipForLoadedNode(node, regionLookup) {
      var lines = [];
      if (node.name != null && String(node.name) !== 'nan') lines.push('Name: ' + node.name);
      if (node.titles != null && String(node.titles) !== 'nan') lines.push('Titles: ' + node.titles);
      if (node.year != null && String(node.year) !== 'nan') lines.push('Birth: ' + node.year);
      if (node.dynasty_name) lines.push('Dynasty: ' + node.dynasty_name);
      if (node.inbreeding_coefficient != null && isFinite(Number(node.inbreeding_coefficient))) {
        lines.push('Inbreeding coefficient: ' + (Number(node.inbreeding_coefficient) * 100).toFixed(3) + '%');
      }
      if (node.region_status === 'OK' || node.region_status === 'PARTIAL') {
        if (node.region_top && node.region_top.length) {
          lines.push('');
          lines.push('Regions:');
          node.region_top.forEach(function(entry) {
            lines.push('  ' + entry[0] + ': ' + Number(entry[1]).toFixed(3));
          });
        }
        var unknown = Number(node.region_unknown_share || 0);
        if (unknown > 1e-12) lines.push('  Unknown: ' + unknown.toFixed(3));
      }
      return lines.join('\n');
    }

    function hydrateFullGraph(data) {
      // A new house payload replaces the active genealogy. Parent records are
      // only a temporary extension of that view, so discard prior-house
      // buckets instead of retaining a growing cross-house cache.
      parentDataBuckets = {};
      parentDataRecords = {};
      var distributions = regionDistributionByNode(data || {});
      var regionLookup = data && data.region_lookup && typeof data.region_lookup === 'object'
        ? data.region_lookup
        : {};
      originalNodes = (Array.isArray(data && data.nodes) ? data.nodes : []).map(function(rawNode) {
        var node = Object.assign({}, rawNode);
        var nodeId = String(node.id);
        var distribution = distributions[nodeId] || {};
        var orderedRegions = Object.keys(distribution).map(function(regionId) {
          return [regionId, distribution[regionId]];
        }).sort(function(left, right) {
          return right[1] - left[1];
        });
        var unknown = Number(node.region_unknown_share || 0);
        if (orderedRegions.length) {
          node.region_distribution = distribution;
          node.region_top = orderedRegions.slice(0, 6).filter(function(entry) {
            return entry[1] > 0;
          }).map(function(entry) {
            return [regionLookup[String(entry[0])] || String(entry[0]), entry[1]];
          });
          node.region_status = unknown > 1e-12 ? 'PARTIAL' : 'OK';
        }
        var label = node.name != null && String(node.name) !== 'nan' ? String(node.name) : String(node.id);
        node.label = label;
        node.title = tooltipForLoadedNode(node, regionLookup);
        node.color = node.region_status === 'OK' ? 'lightgreen' : node.region_status === 'PARTIAL' ? 'khaki' : 'lightgray';
        if (node.dynasty_image_url) {
          node.shape = 'image';
          node.image = node.dynasty_image_url;
        } else {
          // Avoid label-sized ellipses for people without a heraldic image.
          node.shape = 'dot';
        }
        return node;
      });
      originalEdges = (Array.isArray(data && data.edges) ? data.edges : []).map(function(rawEdge) {
        var edge = Object.assign({}, rawEdge);
        edge.arrows = 'to';
        edge.title = edge.relation || '';
        return edge;
      });
      fullGraphReady = true;
      rebuildGraphIndexes();
    }

    function ensureFullGraph() {
      if (fullGraphReady) return Promise.resolve();
      if (fullGraphLoadPromise) return fullGraphLoadPromise;
      if (!window.graphDataUrl) return Promise.reject(new Error('No graph data URL configured.'));
      // Safari has intermittently rejected a bare relative URL here.  Resolve it
      // against the served page so the request is unambiguously same-origin.
      var graphDataUrl = new URL(String(window.graphDataUrl), window.location.href).href;
      updateStatus('Loading dynasty data...');
      showLazyDiagnostic('Lazy graph diagnostic\n1. Fetching ' + graphDataUrl, false);
      fullGraphLoadPromise = fetch(graphDataUrl)
        .then(function(response) {
          if (!response.ok) throw new Error('Could not load graph data (' + response.status + ').');
          showLazyDiagnostic('Lazy graph diagnostic\n1b. Response received; reading JSON...', false);
          return response.text();
        })
        .then(function(text) {
          showLazyDiagnostic('Lazy graph diagnostic\n1c. Parsing ' + text.length + ' bytes of JSON...', false);
          return JSON.parse(text);
        })
        .then(function(data) {
          showLazyDiagnostic('Lazy graph diagnostic\n1d. Reconstructing person nodes...', false);
          hydrateFullGraph(data);
          showLazyDiagnostic(
            'Lazy graph diagnostic\n2. Loaded ' + originalNodes.length +
            ' people and ' + originalEdges.length + ' parent links.',
            false
          );
        })
        .catch(function(error) {
          fullGraphLoadPromise = null;
          throw error;
        });
      return fullGraphLoadPromise;
    }

    function ensureDynastyGraph(dynastyId) {
      var dynastyKey = String(dynastyId);
      if (fullGraphReady && loadedDynastyId === dynastyKey) return Promise.resolve();
      // Retain the whole-graph loader as a compatibility fallback for older
      // generated pages which have no per-dynasty files.
      if (!DYNASTY_DATA_URL) return ensureFullGraph();
      if (dynastyGraphLoadPromise && dynastyGraphLoadPromise.dynastyId === dynastyKey) {
        return dynastyGraphLoadPromise.promise;
      }

      var url = new URL(
        String(DYNASTY_DATA_URL).replace(/\/$/, '') + '/' + encodeURIComponent(dynastyKey) + '.json',
        window.location.href
      );
      if (GRAPH_DATA_VERSION) url.searchParams.set('v', GRAPH_DATA_VERSION);
      updateStatus('Loading ' + (dynastyById[dynastyKey] ? dynastyById[dynastyKey].dynasty_name : 'dynasty') + '...');
      var promise = fetch(url.href)
        .then(function(response) {
          if (!response.ok) throw new Error('Could not load dynasty data (' + response.status + ').');
          return response.text();
        })
        .then(function(text) {
          return JSON.parse(text);
        })
        .then(function(data) {
          hydrateFullGraph(data);
          loadedDynastyId = dynastyKey;
        })
        .catch(function(error) {
          dynastyGraphLoadPromise = null;
          throw error;
        });
      dynastyGraphLoadPromise = { dynastyId: dynastyKey, promise: promise };
      return promise;
    }

    function parentDataBucketForNode(nodeId) {
      var numericId = Number(nodeId);
      if (isFinite(numericId)) return Math.abs(Math.trunc(numericId)) % 256;
      return String(nodeId).split('').reduce(function(total, character) {
        return total + character.charCodeAt(0);
      }, 0) % 256;
    }

    function ensureParentRecord(nodeId) {
      var id = String(nodeId);
      if (parentDataRecords[id]) return Promise.resolve(parentDataRecords[id]);
      if (!PARENT_DATA_URL) return Promise.resolve(null);
      var bucket = parentDataBucketForNode(id);
      if (!parentDataBuckets[bucket]) {
        var url = new URL(String(PARENT_DATA_URL).replace(/\/$/, '') + '/' + bucket + '.json', window.location.href);
        if (GRAPH_DATA_VERSION) url.searchParams.set('v', GRAPH_DATA_VERSION);
        parentDataBuckets[bucket] = fetch(url.href).then(function(response) {
          if (!response.ok) throw new Error('Could not load parent data (' + response.status + ').');
          return response.json();
        }).then(function(payload) {
          Object.keys(payload || {}).forEach(function(key) {
            parentDataRecords[String(key)] = payload[key];
          });
        });
      }
      return parentDataBuckets[bucket].then(function() { return parentDataRecords[id] || null; });
    }

    function mergeParentRecord(record) {
      if (!record || !record.node) return;
      var raw = record.node;
      var id = String(raw.id);
      if (!personNodeById[id]) {
        var node = Object.assign({}, raw);
        node.label = node.name != null && String(node.name) !== 'nan' ? String(node.name) : id;
        node.title = tooltipForLoadedNode(node, {});
        node.color = node.region_status === 'OK' ? 'lightgreen' : node.region_status === 'PARTIAL' ? 'khaki' : 'lightgray';
        if (node.dynasty_image_url) { node.shape = 'image'; node.image = node.dynasty_image_url; }
        else node.shape = 'dot';
        originalNodes.push(node);
        // A direct-parent record can be encountered again immediately while
        // walking the father line. Keep this index current between the final
        // rebuild so the same person is never appended twice.
        personNodeById[id] = node;
      }
      (record.parents || []).forEach(function(parent) {
        var key = String(parent.id) + '->' + id + ':' + String(parent.relation || '');
        var exists = originalEdges.some(function(edge) {
          return String(edge.from) + '->' + String(edge.to) + ':' + String(edge.relation || '') === key;
        });
        if (!exists) originalEdges.push({ from: parent.id, to: raw.id, relation: parent.relation || '' });
      });
    }

    function ensurePatrilinealData(rootId) {
      var visited = {};
      function loadLine(nodeId) {
        var id = String(nodeId);
        if (visited[id]) return Promise.resolve();
        visited[id] = true;
        return ensureParentRecord(id).then(function(record) {
          if (!record) return;
          mergeParentRecord(record);
          var parents = record.parents || [];
          return Promise.all(parents.map(function(parent) {
            return ensureParentRecord(parent.id).then(function(parentRecord) { mergeParentRecord(parentRecord); });
          })).then(function() {
            var father = parents.find(function(parent) {
              return parent.relation === 'father' || parent.relation === 'father_mother';
            });
            return father ? loadLine(father.id) : null;
          });
        });
      }
      return loadLine(rootId).then(function() { rebuildGraphIndexes(); });
    }

    function regionDataBucketForNode(nodeId) {
      var numericId = Number(nodeId);
      if (isFinite(numericId)) return Math.abs(Math.trunc(numericId)) % REGION_DATA_BUCKET_COUNT;
      return String(nodeId).split('').reduce(function(total, character) {
        return total + character.charCodeAt(0);
      }, 0) % REGION_DATA_BUCKET_COUNT;
    }

    function ensureNodeRegionData(nodeId) {
      var id = String(nodeId);
      var originalNode = personNodeById[id];
      if (!originalNode || originalNode._regionDataLoaded || originalNode.region_distribution) {
        return Promise.resolve(originalNode);
      }
      if (!REGION_DATA_URL) return Promise.reject(new Error('No regionality data URL configured.'));

      var bucket = regionDataBucketForNode(id);
      if (!regionDataBucketPromises[bucket]) {
        regionDataBucketPromises[bucket] = fetch(REGION_DATA_URL + '/' + bucket + '.json')
          .then(function(response) {
            if (!response.ok) throw new Error('Could not load regionality data (' + response.status + ').');
            return response.json();
          });
      }
      return regionDataBucketPromises[bucket].then(function(payload) {
        var data = payload && payload[id];
        if (!data) throw new Error('No regionality data found for node ' + id + '.');
        originalNode.region_distribution = data.region_distribution || {};
        originalNode.region_top = data.region_top || [];
        originalNode.region_status = data.region_status || originalNode.region_status;
        originalNode.region_unknown_share = Number(data.region_unknown_share || 0);
        originalNode._regionDataLoaded = true;
        originalNode.title = tooltipForLoadedNode(originalNode, {});

        var visibleNode = nodes.get(nodeId);
        if (visibleNode) {
          nodes.update(Object.assign({}, visibleNode, {
            region_distribution: originalNode.region_distribution,
            region_top: originalNode.region_top,
            region_status: originalNode.region_status,
            region_unknown_share: originalNode.region_unknown_share,
            _regionDataLoaded: true,
            title: originalNode.title
          }));
        }
        return originalNode;
      });
    }

    rebuildGraphIndexes();

    function createControls() {
      if (document.getElementById('overview-controls')) return;

      var panel = document.createElement('div');
      panel.id = 'overview-controls';
      panel.style.position = 'fixed';
      panel.style.top = '10px';
      panel.style.right = '10px';
      panel.style.zIndex = '10030';
      panel.style.background = 'rgba(255,255,255,0.95)';
      panel.style.padding = '6px';
      panel.style.border = '1px solid #ccc';
      panel.style.borderRadius = '6px';
      panel.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
      panel.style.fontFamily = 'Arial, sans-serif';
      panel.innerHTML = [
        '<button id="graph-back-btn" type="button" title="Back" aria-label="Back" style="width:30px;height:30px;padding:0;border:1px solid #bbb;border-radius:999px;background:#fff;cursor:pointer;font-size:17px;line-height:1;">&#8592;</button>',
        '<button id="graph-forward-btn" type="button" title="Forward" aria-label="Forward" style="width:30px;height:30px;margin-left:4px;padding:0;border:1px solid #bbb;border-radius:999px;background:#fff;cursor:pointer;font-size:17px;line-height:1;">&#8594;</button>'
      ].join('');

      document.body.appendChild(panel);
    }

    function createMapChooser() {
      if (document.getElementById('overview-map-chooser')) return;
      var chooser = document.createElement('div');
      chooser.id = 'overview-map-chooser';
      chooser.style.position = 'fixed';
      chooser.style.inset = '0';
      chooser.style.zIndex = '10040';
      chooser.style.display = 'flex';
      chooser.style.alignItems = 'center';
      chooser.style.justifyContent = 'center';
      chooser.style.background = 'rgba(246,244,237,0.96)';
      chooser.style.fontFamily = 'Georgia, serif';
      chooser.innerHTML = [
        '<div style="width:min(700px,calc(100vw - 40px));padding:42px 36px;text-align:center;border:1px solid #c9c1b1;border-radius:14px;background:#fffdf7;box-shadow:0 18px 54px rgba(48,39,21,0.18);">',
        '<div style="font-size:30px;letter-spacing:0.02em;color:#2f3d37;margin-bottom:10px;">Genealogy Atlas</div>',
        '<div style="font:15px/1.5 Arial,sans-serif;color:#625e53;margin-bottom:30px;">Choose a world to explore.</div>',
        '<div style="display:flex;gap:14px;justify-content:center;flex-wrap:wrap;">',
        '<button data-overview-map="Europe" type="button" style="min-width:170px;padding:16px 20px;border:1px solid #8b887b;border-radius:8px;background:#edf2ec;cursor:pointer;font:17px Georgia,serif;color:#25352a;">Europe</button>',
        '<button data-overview-map="Asia" type="button" style="min-width:170px;padding:16px 20px;border:1px solid #8b887b;border-radius:8px;background:#f2eee4;cursor:pointer;font:17px Georgia,serif;color:#3d3426;">Asia</button>',
        '<button data-overview-map="Greek Mythology" type="button" style="min-width:170px;padding:16px 20px;border:1px solid #8b887b;border-radius:8px;background:#edf0f6;cursor:pointer;font:17px Georgia,serif;color:#283554;">Greek Mythology</button>',
        '<button data-overview-map="Antiquity" type="button" style="min-width:170px;padding:16px 20px;border:1px solid #8b887b;border-radius:8px;background:#f4ece0;cursor:pointer;font:17px Georgia,serif;color:#523825;">Antiquity</button>',
        '</div></div>'
      ].join('');
      chooser.addEventListener('click', function(event) {
        var button = event.target.closest('[data-overview-map]');
        if (!button) return;
        setOverviewMap(button.getAttribute('data-overview-map'));
        chooser.style.display = 'none';
        state.mode = 'overview';
        state.activeOverviewDynastyId = null;
        state.activePatrilineRootId = null;
        replaceData(buildOverviewNodes(), buildOverviewEdges(), true, true);
        syncControls();
      });
      document.body.appendChild(chooser);
    }

    function showMapChooser() {
      var chooser = document.getElementById('overview-map-chooser');
      if (chooser) chooser.style.display = 'flex';
    }

    function hideMapChooser() {
      var chooser = document.getElementById('overview-map-chooser');
      if (chooser) chooser.style.display = 'none';
    }

    function createHoverPanel() {
      if (document.getElementById('maternal-action-panel')) return;

      var panel = document.createElement('div');
      panel.id = 'maternal-action-panel';
      panel.style.position = 'fixed';
      panel.style.zIndex = '10000';
      panel.style.display = 'none';
      panel.style.background = 'rgba(255,255,255,0.98)';
      panel.style.border = '1px solid #c8c8c8';
      panel.style.borderRadius = '8px';
      panel.style.boxShadow = '0 4px 14px rgba(0,0,0,0.18)';
      panel.style.padding = '6px';
      panel.style.fontFamily = 'Arial, sans-serif';

      panel.innerHTML = [
        '<button id="maternal-expand-btn" title="Expand ancestors" style="width:36px;height:36px;margin-right:6px;border:1px solid #bbb;border-radius:6px;background:#fff;cursor:pointer;">⤢</button>',
        '<button id="maternal-dynasty-btn" title="Go to dynasty" style="width:36px;height:36px;margin-right:6px;border:1px solid #bbb;border-radius:6px;background:#fff;cursor:pointer;">♛</button>',
        '<button id="maternal-region-map-btn" title="Open regional map" style="width:36px;height:36px;border:1px solid #bbb;border-radius:6px;background:#fff;cursor:pointer;">🗺</button>'
      ].join('');

      panel.addEventListener('mouseenter', function() {
        if (hoverPanelHideTimer) {
          clearTimeout(hoverPanelHideTimer);
          hoverPanelHideTimer = null;
        }
      });
      panel.addEventListener('mouseleave', function() {
        scheduleHideHoverPanel();
      });

      document.body.appendChild(panel);
    }

    function currentHoveredNode() {
      return hoverNodeId != null ? nodes.get(hoverNodeId) : null;
    }

    function hideHoverPanel() {
      var panel = document.getElementById('maternal-action-panel');
      if (!panel) return;
      panel.style.display = 'none';
    }

    function scheduleHideHoverPanel() {
      if (hoverPanelHideTimer) clearTimeout(hoverPanelHideTimer);
      hoverPanelHideTimer = setTimeout(function() {
        hideHoverPanel();
        hoverNodeId = null;
      }, 180);
    }

    function showHoverPanel(nodeId) {
      var panel = document.getElementById('maternal-action-panel');
      var node = nodes.get(nodeId);
      if (!panel || !node) return;

      if (hoverPanelHideTimer) {
        clearTimeout(hoverPanelHideTimer);
        hoverPanelHideTimer = null;
      }

      hoverNodeId = nodeId;
      var expandBtn = document.getElementById('maternal-expand-btn');
      var dynastyBtn = document.getElementById('maternal-dynasty-btn');
      var mapBtn = document.getElementById('maternal-region-map-btn');
      var canExpandAncestors = !!node.maternal_bridge;
      expandBtn.style.display = canExpandAncestors ? 'inline-block' : 'none';
      expandBtn.disabled = !canExpandAncestors;
      dynastyBtn.disabled = false;
      dynastyBtn.style.opacity = '1';
      dynastyBtn.style.cursor = 'pointer';
      // Regionality vectors are loaded lazily.  A computable node can open its
      // map immediately; openRegionMapForNode will fetch its small data bucket.
      var hasRegionMap = node.region_status === 'OK' || node.region_status === 'PARTIAL';
      mapBtn.disabled = !hasRegionMap;
      mapBtn.style.opacity = hasRegionMap ? '1' : '0.45';
      mapBtn.style.cursor = hasRegionMap ? 'pointer' : 'default';

      var positions = network.getPositions([nodeId]);
      var canvasPos = positions[nodeId];
      if (!canvasPos || typeof network.canvasToDOM !== 'function') return;
      var domPos = network.canvasToDOM(canvasPos);

      panel.style.display = 'block';
      panel.style.top = (domPos.y - 18) + 'px';
      panel.style.left = (domPos.x - panel.offsetWidth - 18) + 'px';
    }

    function createRegionMapModal() {
      if (document.getElementById('region-map-modal')) return;
      var container = document.getElementById('mynetwork');
      if (!container) return;
      if (window.getComputedStyle(container).position === 'static') {
        container.style.position = 'relative';
      }

      var modal = document.createElement('div');
      modal.id = 'region-map-modal';
      modal.style.position = 'absolute';
      modal.style.inset = '0';
      modal.style.zIndex = '10005';
      modal.style.display = 'none';
      modal.style.background = '#f4f0e8';
      modal.style.padding = '0';
      modal.style.boxSizing = 'border-box';
      modal.style.fontFamily = 'Arial, sans-serif';

      modal.innerHTML = [
        '<div id="region-map-card" style="position:relative;width:100%;height:100%;margin:0;background:#f4f0e8;overflow:hidden;">',
        '<div id="region-map-toolbar" style="position:absolute;top:24px;left:24px;z-index:2;display:flex;gap:8px;">',
        '<button id="region-map-reset-btn" type="button" style="padding:8px 12px;border:1px solid #bbb;border-radius:8px;background:#fff;cursor:pointer;font-size:12px;">Reset View</button>',
        '<div style="padding:8px 10px;border:1px solid #ddd;border-radius:8px;background:rgba(255,255,255,0.88);font-size:12px;color:#555;">Drag to move, wheel to zoom</div>',
        '</div>',
        '<div id="region-map-stage" style="position:relative;width:100%;height:100%;display:block;overflow:hidden;background:#ede7db;"></div>',
        '</div>'
      ].join('');

      container.appendChild(modal);
    }

    function createRegionLegendPanel() {
      if (document.getElementById('region-legend-panel')) return;

      var panel = document.createElement('div');
      panel.id = 'region-legend-panel';
      panel.style.position = 'fixed';
      panel.style.right = '10px';
      panel.style.zIndex = '10029';
      panel.style.display = 'none';
      panel.style.background = 'rgba(255,255,255,0.95)';
      panel.style.padding = '10px 12px';
      panel.style.border = '1px solid #ccc';
      panel.style.borderRadius = '6px';
      panel.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
      panel.style.fontFamily = 'Arial, sans-serif';
      panel.style.width = '360px';
      panel.style.maxHeight = 'calc(100vh - 220px)';
      panel.style.overflow = 'auto';
      panel.innerHTML = [
        '<div style="font-size:13px;font-weight:700;margin-bottom:10px;">Legend</div>',
        '<div id="region-map-legend" style="font-size:12px;color:#333;"></div>',
        '<div style="font-size:13px;font-weight:700;margin:18px 0 10px;">Not Displayed On This Map</div>',
        '<div id="region-map-missing" style="font-size:12px;color:#333;"></div>'
      ].join('');

      document.body.appendChild(panel);
    }

    function createRegionHoverTooltip() {
      if (document.getElementById('region-hover-tooltip')) return;
      var tooltip = document.createElement('div');
      tooltip.id = 'region-hover-tooltip';
      tooltip.style.position = 'fixed';
      tooltip.style.zIndex = '10031';
      tooltip.style.display = 'none';
      tooltip.style.pointerEvents = 'none';
      tooltip.style.background = 'rgba(255,255,255,0.96)';
      tooltip.style.border = '1px solid #cfcfcf';
      tooltip.style.borderRadius = '6px';
      tooltip.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
      tooltip.style.padding = '6px 8px';
      tooltip.style.fontFamily = 'Arial, sans-serif';
      tooltip.style.fontSize = '12px';
      tooltip.style.color = '#222';
      document.body.appendChild(tooltip);
    }

    function createOverviewEdgeTooltip() {
      if (document.getElementById('overview-edge-tooltip')) return;
      var tooltip = document.createElement('div');
      tooltip.id = 'overview-edge-tooltip';
      tooltip.style.position = 'fixed';
      tooltip.style.zIndex = '10032';
      tooltip.style.display = 'none';
      tooltip.style.pointerEvents = 'none';
      tooltip.style.background = 'rgba(255,255,255,0.97)';
      tooltip.style.border = '1px solid #cfcfcf';
      tooltip.style.borderRadius = '6px';
      tooltip.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
      tooltip.style.padding = '6px 8px';
      tooltip.style.fontFamily = 'Arial, sans-serif';
      tooltip.style.fontSize = '12px';
      tooltip.style.color = '#222';
      tooltip.style.maxWidth = '360px';
      document.body.appendChild(tooltip);
    }

    function hideOverviewEdgeTooltip() {
      activeOverviewEdgeTooltipId = null;
      clearOverviewEdgeHighlight();
      var tooltip = document.getElementById('overview-edge-tooltip');
      if (!tooltip) return;
      tooltip.style.display = 'none';
      tooltip.innerHTML = '';
    }

    function clearOverviewEdgeHighlight() {
      if (!activeOverviewEdgeId) return;
      var previous = edges.get(activeOverviewEdgeId);
      if (!previous) {
        activeOverviewEdgeId = null;
        return;
      }
      edges.update({
        id: previous.id,
        width: previous.overview_base_width,
        color: { color: '#7A7A7A', highlight: '#7A7A7A', hover: '#7A7A7A' }
      });
      activeOverviewEdgeId = null;
    }

    function setOverviewEdgeHighlight(edge) {
      if (!edge) {
        clearOverviewEdgeHighlight();
        return;
      }
      if (activeOverviewEdgeId === String(edge.id)) {
        return;
      }
      clearOverviewEdgeHighlight();
      edges.update({
        id: edge.id,
        width: edge.overview_base_width,
        color: { color: '#7A7A7A', highlight: '#7A7A7A', hover: '#7A7A7A' }
      });
      activeOverviewEdgeId = String(edge.id);
    }

    function showOverviewEdgeTooltip(edge, clientX, clientY) {
      if (!edge) {
        hideOverviewEdgeTooltip();
        return;
      }
      createOverviewEdgeTooltip();
      var tooltip = document.getElementById('overview-edge-tooltip');
      if (!tooltip) return;
      setOverviewEdgeHighlight(edge);
      activeOverviewEdgeTooltipId = String(edge.id);
      tooltip.innerHTML = [
        '<div style="font-weight:700;margin-bottom:4px;">' + edge.overview_label + '</div>',
        '<div>Inter-dynasty marriages: ' + edge.overview_count + '</div>'
      ].join('');
      tooltip.style.left = (clientX + 14) + 'px';
      tooltip.style.top = (clientY + 14) + 'px';
      tooltip.style.display = 'block';
    }

    function showOverviewEdgeTooltipFromDom(edge, domPoint) {
      if (!edge || !domPoint || !network || !network.body || !network.body.container) {
        hideOverviewEdgeTooltip();
        return;
      }
      var rect = network.body.container.getBoundingClientRect();
      showOverviewEdgeTooltip(edge, rect.left + domPoint.x, rect.top + domPoint.y);
    }

    function pointSegmentDistance(point, start, end) {
      var dx = end.x - start.x;
      var dy = end.y - start.y;
      if (dx === 0 && dy === 0) {
        var ddx = point.x - start.x;
        var ddy = point.y - start.y;
        return Math.sqrt(ddx * ddx + ddy * ddy);
      }
      var projection = ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy);
      var t = Math.max(0, Math.min(1, projection));
      var closestX = start.x + t * dx;
      var closestY = start.y + t * dy;
      var offsetX = point.x - closestX;
      var offsetY = point.y - closestY;
      return Math.sqrt(offsetX * offsetX + offsetY * offsetY);
    }

    function findOverviewEdgeAtPointer(domPoint) {
      if (state.mode !== 'overview' || !network || typeof network.DOMtoCanvas !== 'function') {
        return null;
      }
      if (typeof network.getNodeAt === 'function' && network.getNodeAt(domPoint)) {
        return null;
      }

      var canvasPoint = network.DOMtoCanvas(domPoint);
      var scale = typeof network.getScale === 'function' ? network.getScale() : 1;
      var baseThreshold = 4.5 / Math.max(scale, 0.0001);
      var best = null;

      edges.get().forEach(function(edge) {
        if (!edge || !edge.isOverviewEdge) return;
        var fromNode = nodes.get(edge.from);
        var toNode = nodes.get(edge.to);
        if (!fromNode || !toNode) return;
        if (!Number.isFinite(fromNode.x) || !Number.isFinite(fromNode.y) || !Number.isFinite(toNode.x) || !Number.isFinite(toNode.y)) {
          return;
        }

        var width = Number(edge.width) || 0;
        var threshold = Math.max(baseThreshold, (4.5 + width * 16) / Math.max(scale, 0.0001));
        var distance = pointSegmentDistance(canvasPoint, { x: fromNode.x, y: fromNode.y }, { x: toNode.x, y: toNode.y });
        if (distance > threshold) return;

        var score = distance / threshold;
        if (!best || score < best.score || (Math.abs(score - best.score) < 1e-6 && (Number(edge.overview_count) || 0) > (Number(best.edge.overview_count) || 0))) {
          best = { edge: edge, score: score };
        }
      });

      return best ? best.edge : null;
    }

    function updateRegionLegendPanelLayout() {
      var panel = document.getElementById('region-legend-panel');
      var controls = document.getElementById('overview-controls');
      if (!panel || !controls) return;
      var rect = controls.getBoundingClientRect();
      panel.style.top = (rect.bottom + 10) + 'px';
      panel.style.maxHeight = Math.max(160, window.innerHeight - rect.bottom - 20) + 'px';
    }

    function closeRegionMapModal() {
      var modal = document.getElementById('region-map-modal');
      if (!modal) return;
      modal.style.display = 'none';
      var legendPanel = document.getElementById('region-legend-panel');
      if (legendPanel) legendPanel.style.display = 'none';
      activeRegionMapView = null;
    }

    function setRegionMapMessage(title, subtitle, message) {
      createRegionMapModal();
      createRegionLegendPanel();
      var modal = document.getElementById('region-map-modal');
      var stage = document.getElementById('region-map-stage');
      var legendPanel = document.getElementById('region-legend-panel');
      var legend = document.getElementById('region-map-legend');
      var missing = document.getElementById('region-map-missing');
      stage.innerHTML = '<div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-size:14px;color:#555;padding:24px;text-align:center;background:rgba(255,255,255,0.9);border:1px solid #ddd;border-radius:8px;">' + message + '</div>';
      legend.innerHTML = '';
      missing.innerHTML = '';
      modal.style.display = 'block';
      if (legendPanel) legendPanel.style.display = 'none';
    }

    function componentHex(value) {
      var text = Math.max(0, Math.min(255, value)).toString(16).toUpperCase();
      return text.length < 2 ? '0' + text : text;
    }

    function rgbToHex(r, g, b) {
      return '#' + componentHex(r) + componentHex(g) + componentHex(b);
    }

    function formatPercent(share) {
      var percent = Number(share) * 100;
      if (!(percent > 0)) {
        return '0.0%';
      }
      if (percent >= 0.1) {
        return percent.toPrecision(2) + '%';
      }
      return percent.toExponential(1) + '%';
    }

    function lerp(start, end, weight) {
      return Math.round(start + (end - start) * weight);
    }

    function shareToFillRgb(share) {
      var clamped = Math.max(0, Math.min(1, Number(share) || 0));
      if (clamped <= 0) {
        return [255, 255, 255];
      }
      var transformed = Math.log10(1 + 99999 * clamped) / 5;
      var stops = [
        { at: 0.0, rgb: [255, 247, 204] },
        { at: 0.14, rgb: [255, 235, 153] },
        { at: 0.32, rgb: [255, 213, 102] },
        { at: 0.56, rgb: [245, 171, 68] },
        { at: 0.8, rgb: [198, 48, 35] },
        { at: 1.0, rgb: [108, 0, 0] }
      ];
      for (var i = 1; i < stops.length; i += 1) {
        if (transformed <= stops[i].at) {
          var prev = stops[i - 1];
          var next = stops[i];
          var local = (transformed - prev.at) / (next.at - prev.at || 1);
          return [
            lerp(prev.rgb[0], next.rgb[0], local),
            lerp(prev.rgb[1], next.rgb[1], local),
            lerp(prev.rgb[2], next.rgb[2], local)
          ];
        }
      }
      return stops[stops.length - 1].rgb.slice();
    }

    function regionDistributionEntries(node) {
      var distribution = node && node.region_distribution ? node.region_distribution : null;
      var out = [];
      if (!distribution || typeof distribution !== 'object') return out;
      Object.keys(distribution).forEach(function(regionId) {
        var share = Number(distribution[regionId]);
        if (!(share > 0)) return;
        var catalogEntry = regionCatalogById[String(regionId)] || {};
        out.push({
          id: String(regionId),
          name: catalogEntry.name || ('Region ' + regionId),
          color: catalogEntry.color || null,
          share: share
        });
      });
      out.sort(function(a, b) { return b.share - a.share; });
      return out;
    }

    function nodeUnknownRegionShare(node) {
      var share = Number(node && node.region_unknown_share);
      return share > 0 ? Math.min(1, share) : 0;
    }

    function recolorSvgVector(svgText, entryByColor) {
      var parser = new DOMParser();
      var doc = parser.parseFromString(svgText, 'image/svg+xml');
      var svg = doc.documentElement;
      var matchedColors = {};
      var neutralFill = 'rgb(255,255,255)';
      var elements = svg.querySelectorAll('[style], [fill]');

      elements.forEach(function(el) {
        var rawFill = null;
        if (el.getAttribute('fill')) {
          rawFill = canonicalRegionColor(el.getAttribute('fill'));
        }
        if (!rawFill) {
          var styleAttr = el.getAttribute('style') || '';
          var match = styleAttr.match(/fill:\s*(#[0-9A-Fa-f]{6})/);
          if (match) {
            rawFill = canonicalRegionColor(match[1]);
          }
        }
        if (!rawFill) return;

        var entry = entryByColor[rawFill];
        if (entry) {
          var fill = shareToFillRgb(entry.share);
          el.style.fill = 'rgb(' + fill.join(',') + ')';
          el.setAttribute('data-region-id', entry.id);
          el.setAttribute('data-region-name', entry.name);
          el.setAttribute('data-region-share', String(entry.share));
          matchedColors[rawFill] = true;
        } else if (allRegionColors[rawFill]) {
          el.style.fill = neutralFill;
        }
      });

      return {
        svg: svg,
        matchedColors: matchedColors
      };
    }

    function attachRegionHover(svg) {
      if (!svg) return;
      createRegionHoverTooltip();
      var tooltip = document.getElementById('region-hover-tooltip');
      var highlighted = [];

      function clearHighlight() {
        highlighted.forEach(function(el) {
          el.style.stroke = '';
          el.style.strokeWidth = '';
          el.style.strokeOpacity = '';
          el.style.filter = '';
        });
        highlighted = [];
      }

      function moveTooltip(event) {
        if (!tooltip || tooltip.style.display === 'none') return;
        tooltip.style.left = (event.clientX + 14) + 'px';
        tooltip.style.top = (event.clientY + 14) + 'px';
      }

      svg.addEventListener('mouseover', function(event) {
        var target = event.target;
        if (!target || !target.getAttribute) return;
        var regionId = target.getAttribute('data-region-id');
        if (!regionId) return;

        clearHighlight();
        highlighted = Array.prototype.slice.call(
          svg.querySelectorAll('[data-region-id="' + regionId.replace(/"/g, '\\"') + '"]')
        );
        highlighted.forEach(function(el) {
          el.style.stroke = '#111';
          el.style.strokeWidth = '10';
          el.style.strokeOpacity = '0.8';
          el.style.filter = 'brightness(0.96)';
        });

        var regionName = target.getAttribute('data-region-name') || ('Region ' + regionId);
        var share = Number(target.getAttribute('data-region-share') || 0);
        tooltip.innerHTML = '<div style="font-weight:700;margin-bottom:2px;">' + regionName + '</div><div>' + formatPercent(share) + '</div>';
        tooltip.style.display = 'block';
      });

      svg.addEventListener('mousemove', moveTooltip);
      svg.addEventListener('mouseout', function(event) {
        var target = event.target;
        if (!target || !target.getAttribute || !target.getAttribute('data-region-id')) return;
        var related = event.relatedTarget;
        if (related && svg.contains(related) && related.getAttribute && related.getAttribute('data-region-id') === target.getAttribute('data-region-id')) {
          return;
        }
        clearHighlight();
        tooltip.style.display = 'none';
      });
    }

    function openRegionMapForNode(nodeId, savedView, restoringFromHistory) {
      var node = nodes.get(nodeId);
      if (!node) return;

      var nodeTitle = node.label || node.name || ('Node ' + nodeId);
      if (node.region_status !== 'OK' && node.region_status !== 'PARTIAL') {
        setRegionMapMessage(nodeTitle, '', 'Regionality was not computed for this node.');
        return;
      }
      if (!node.region_distribution && !node._regionDataLoaded) {
        setRegionMapMessage(nodeTitle, '', 'Loading regionality data...');
        ensureNodeRegionData(nodeId).then(function() {
          openRegionMapForNode(nodeId, savedView, restoringFromHistory);
        }).catch(function(error) {
          setRegionMapMessage(nodeTitle, '', 'Could not load regionality data: ' + error.message);
        });
        return;
      }
      if (!node.region_distribution) {
        setRegionMapMessage(nodeTitle, '', 'Regionality was not computed for this node.');
        return;
      }

      if (!iberiaVectorReady || !iberiaVectorText) {
        pendingRegionMapNodeId = nodeId;
        setRegionMapMessage(nodeTitle, '', 'Loading Iberia map...');
        return;
      }

      state.activeRegionMapNodeId = nodeId;

      createRegionMapModal();
      createRegionLegendPanel();
      var modal = document.getElementById('region-map-modal');
      var stage = document.getElementById('region-map-stage');
      var legendPanel = document.getElementById('region-legend-panel');
      var legend = document.getElementById('region-map-legend');
      var missing = document.getElementById('region-map-missing');
      var resetBtn = document.getElementById('region-map-reset-btn');
      var entries = regionDistributionEntries(node);
      var unknownShare = nodeUnknownRegionShare(node);
      var entryByColor = {};
      entries.forEach(function(entry) {
        if (entry.color) {
          entryByColor[entry.color] = entry;
        }
      });

      var cacheKey = String(nodeId) + ':svg';
      var cached = regionMapRenderCache[cacheKey];
      var visualRoot;
      var matchedColors = {};
      var contentWidth;
      var contentHeight;
      if (cached) {
        visualRoot = cached.factory();
        matchedColors = Object.assign({}, cached.matchedColors);
        contentWidth = cached.width;
        contentHeight = cached.height;
      } else {
        var recolored = recolorSvgVector(iberiaVectorText, entryByColor);
        var svg = recolored.svg;
        matchedColors = Object.assign({}, recolored.matchedColors);
        contentWidth = Number(svg.getAttribute('width')) || 7419;
        contentHeight = Number(svg.getAttribute('height')) || 6320;
        svg.setAttribute('width', String(contentWidth));
        svg.setAttribute('height', String(contentHeight));
        svg.style.display = 'block';
        svg.style.width = contentWidth + 'px';
        svg.style.height = contentHeight + 'px';
        visualRoot = svg;
        var cachedMarkup = svg.outerHTML;
        regionMapRenderCache[cacheKey] = {
          width: contentWidth,
          height: contentHeight,
          matchedColors: Object.assign({}, matchedColors),
          factory: function() {
            return new DOMParser().parseFromString(cachedMarkup, 'image/svg+xml').documentElement;
          }
        };
      }
      if (visualRoot && visualRoot.tagName && String(visualRoot.tagName).toLowerCase() === 'svg') {
        attachRegionHover(visualRoot);
      }

      var frame = document.createElement('div');
      frame.style.position = 'absolute';
      frame.style.left = '0';
      frame.style.top = '0';
      frame.style.width = contentWidth + 'px';
      frame.style.height = contentHeight + 'px';
      frame.style.transformOrigin = '0 0';
      frame.style.cursor = 'grab';
      frame.appendChild(visualRoot);

      var world = document.createElement('div');
      world.style.position = 'absolute';
      world.style.left = '0';
      world.style.top = '0';
      world.style.width = contentWidth + 'px';
      world.style.height = contentHeight + 'px';
      world.appendChild(frame);

      var matchedMissingEntries = entries.filter(function(entry) {
        return !entry.color || !matchedColors[entry.color];
      });

      stage.innerHTML = '';
      stage.appendChild(world);
      modal.style.display = 'block';
      if (legendPanel) {
        updateRegionLegendPanelLayout();
        legendPanel.style.display = 'block';
      }

      var viewState = savedView
        ? {
            scale: Number(savedView.scale) || 1,
            x: Number(savedView.x) || 0,
            y: Number(savedView.y) || 0
          }
        : { scale: 1, x: 0, y: 0 };
      function applyView() {
        frame.style.transform = 'translate(' + viewState.x + 'px,' + viewState.y + 'px) scale(' + viewState.scale + ')';
        activeRegionMapView = {
          scale: viewState.scale,
          x: viewState.x,
          y: viewState.y
        };
      }
      function fitView() {
        var stageWidth = stage.clientWidth || 1;
        var stageHeight = stage.clientHeight || 1;
        var scaleX = stageWidth / contentWidth;
        var scaleY = stageHeight / contentHeight;
        viewState.scale = Math.min(scaleX, scaleY) * 0.96;
        viewState.x = (stageWidth - contentWidth * viewState.scale) / 2;
        viewState.y = (stageHeight - contentHeight * viewState.scale) / 2;
        applyView();
      }
      if (savedView) {
        applyView();
      } else {
        fitView();
      }
      resetBtn.onclick = fitView;

      var dragState = null;
      frame.onmousedown = function(event) {
        dragState = {
          startX: event.clientX,
          startY: event.clientY,
          originX: viewState.x,
          originY: viewState.y
        };
        frame.style.cursor = 'grabbing';
        event.preventDefault();
      };
      window.onmouseup = function() {
        dragState = null;
        frame.style.cursor = 'grab';
      };
      window.onmousemove = function(event) {
        if (!dragState || modal.style.display === 'none') return;
        viewState.x = dragState.originX + (event.clientX - dragState.startX);
        viewState.y = dragState.originY + (event.clientY - dragState.startY);
        applyView();
      };
      stage.onwheel = function(event) {
        event.preventDefault();
        var rect = stage.getBoundingClientRect();
        var pointerX = event.clientX - rect.left;
        var pointerY = event.clientY - rect.top;
        var prevScale = viewState.scale;
        var nextScale = event.deltaY < 0 ? prevScale * 1.15 : prevScale / 1.15;
        nextScale = Math.max(0.08, Math.min(12, nextScale));
        var worldX = (pointerX - viewState.x) / prevScale;
        var worldY = (pointerY - viewState.y) / prevScale;
        viewState.scale = nextScale;
        viewState.x = pointerX - worldX * nextScale;
        viewState.y = pointerY - worldY * nextScale;
        applyView();
      };

      if (entries.length) {
        var legendEntries = entries.slice();
        if (unknownShare > 0) {
          legendEntries.push({
            id: '__unknown__',
            name: 'Unknown',
            share: unknownShare,
            unknown: true
          });
        }
        legend.innerHTML = legendEntries.map(function(entry) {
          var swatch = entry.unknown ? [210, 210, 210] : shareToFillRgb(entry.share);
          return [
            '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">',
            '<span style="display:inline-block;width:16px;height:16px;flex:0 0 auto;border-radius:3px;border:1px solid rgba(0,0,0,0.18);background:rgb(' + swatch.join(',') + ');"></span>',
            '<span style="flex:1 1 auto;line-height:1.25;">' + entry.name + '</span>',
            '<span style="color:#666;white-space:nowrap;">' + formatPercent(entry.share) + '</span>',
            '</div>'
          ].join('');
        }).join('');
      } else {
        if (unknownShare > 0) {
          legend.innerHTML = '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;"><span style="display:inline-block;width:16px;height:16px;flex:0 0 auto;border-radius:3px;border:1px solid rgba(0,0,0,0.18);background:rgb(210,210,210);"></span><span style="flex:1 1 auto;line-height:1.25;">Unknown</span><span style="color:#666;white-space:nowrap;">' + formatPercent(unknownShare) + '</span></div>';
        } else {
          legend.innerHTML = '<div style="color:#666;">No regional distribution available.</div>';
        }
      }

      if (matchedMissingEntries.length) {
        missing.innerHTML = matchedMissingEntries.map(function(entry) {
          return '<div style="margin-bottom:8px;">' + entry.name + ' was not displayed (' + formatPercent(entry.share) + ').</div>';
        }).join('');
      } else {
        missing.innerHTML = '<div style="color:#666;">All displayed regional components were present on this map.</div>';
      }

      if (!restoringFromHistory) {
        hideHoverPanel();
      }
    }

    function syncControls() {
      var backBtn = document.getElementById('graph-back-btn');
      var forwardBtn = document.getElementById('graph-forward-btn');
      // At the root, Back returns to the atlas selector instead of becoming
      // inert. This also makes it possible to switch Europe/Asia/Greece.
      if (backBtn) backBtn.disabled = false;
      if (forwardBtn) forwardBtn.disabled = forwardHistoryStack.length === 0;
    }

    function cloneExpandedAncestorRoots() {
      return JSON.parse(JSON.stringify(state.expandedAncestorRoots || {}));
    }

    function captureSnapshot() {
      var viewPosition = typeof network.getViewPosition === 'function' ? network.getViewPosition() : { x: 0, y: 0 };
      var scale = typeof network.getScale === 'function' ? network.getScale() : 1;
      return {
        mode: state.mode,
        selectedDynastyId: state.selectedDynastyId,
        activePatrilineRootId: state.activePatrilineRootId,
        selectedPersonId: state.selectedPersonId,
        activeRegionMapNodeId: state.activeRegionMapNodeId,
        overviewMap: state.overviewMap,
        dynastyLayoutMode: state.dynastyLayoutMode,
        showMinorNodes: state.showMinorNodes,
        showMaternalBridges: state.showMaternalBridges,
        expandedAncestorRoots: cloneExpandedAncestorRoots(),
        regionMapView: activeRegionMapView ? Object.assign({}, activeRegionMapView) : null,
        camera: {
          x: viewPosition.x,
          y: viewPosition.y,
          scale: scale
        }
      };
    }

    function restoreSnapshot(snapshot) {
      hideMapChooser();
      state.mode = snapshot.mode;
      state.selectedDynastyId = snapshot.selectedDynastyId;
      state.activePatrilineRootId = snapshot.activePatrilineRootId;
      state.selectedPersonId = snapshot.selectedPersonId;
      state.activeRegionMapNodeId = snapshot.activeRegionMapNodeId || null;
      setOverviewMap(snapshot.overviewMap);
      setPersistedDynastyLayoutMode('genealogical');
      state.showMinorNodes = !!snapshot.showMinorNodes;
      state.showMaternalBridges = !!snapshot.showMaternalBridges;
      state.expandedAncestorRoots = snapshot.expandedAncestorRoots || {};
      syncControls();
      applyMode(false);
      if (state.activeRegionMapNodeId != null) {
        openRegionMapForNode(state.activeRegionMapNodeId, snapshot.regionMapView || null, true);
      } else {
        closeRegionMapModal();
      }
      if (snapshot.camera && typeof network.moveTo === 'function') {
        setTimeout(function() {
          network.moveTo({
            position: { x: snapshot.camera.x, y: snapshot.camera.y },
            scale: snapshot.camera.scale,
            animation: false
          });
        }, 40);
      }
    }

    function pushHistory() {
      historyStack.push(captureSnapshot());
      if (historyStack.length > 100) historyStack.shift();
      forwardHistoryStack = [];
      syncControls();
    }

    function updateStatus(text) {
      var status = document.getElementById('graph-mode-status');
      if (status) status.textContent = text;
    }

    function hideLoadingOverlay() {
      var loadingBar = document.getElementById('loadingBar');
      var text = document.getElementById('text');
      var bar = document.getElementById('bar');
      if (!loadingBar) return;
      if (text) text.innerHTML = '100%';
      if (bar) bar.style.width = '496px';
      loadingBar.style.opacity = 0;
      setTimeout(function() {
        if (loadingBar) loadingBar.style.display = 'none';
      }, 100);
    }

    function updateOverviewBackground() {
      var container = document.getElementById('mynetwork');
      if (!container) return;
      if (state.mode === 'overview') {
        container.style.backgroundColor = '#eef3f7';
      } else {
        container.style.backgroundColor = '#ffffff';
      }
    }

    function drawOverviewBackground(ctx) {
      if (!overviewMapReady) return;
      if (state.mode !== 'overview') return;
      var dimensions = activeOverviewMapDimensions();
      ctx.save();
      ctx.globalAlpha = 0.97;
      ctx.drawImage(
        overviewMapImage,
        -dimensions.width / 2,
        -dimensions.height / 2,
        dimensions.width,
        dimensions.height
      );
      ctx.restore();
    }

    function currentScale() {
      return typeof network.getScale === 'function' ? network.getScale() : 1;
    }

    function cloneNode(node, stripPosition) {
      var copy = Object.assign({}, node);
      if (stripPosition) {
        delete copy.x;
        delete copy.y;
        delete copy.fixed;
      }
      return copy;
    }

    function parseBirthYear(node) {
      if (!node || !node.title) return null;
      var match = node.title.match(/Birth:\s*(\d{3,4})/);
      if (!match) return null;
      return parseInt(match[1], 10);
    }

    function normalizeSelectedDynasty() {
      if (state.selectedDynastyId === 'all') return 'all';
      if (dynastyById[String(state.selectedDynastyId)]) return String(state.selectedDynastyId);
      return 'all';
    }

    function normalizeDynastyLayoutMode(value) {
      if (value === 'centroid_map') return 'centroid_map';
      return 'genealogical';
    }

    function setPersistedDynastyLayoutMode(value) {
      persistedDynastyLayoutMode = normalizeDynastyLayoutMode(value);
      state.dynastyLayoutMode = persistedDynastyLayoutMode;
      try {
        window.sessionStorage.setItem('graphDynastyLayoutMode', persistedDynastyLayoutMode);
      } catch (_error) {
      }
    }

    function currentDynastyContextKey() {
      return state.activePatrilineRootId != null
        ? 'root:' + String(state.activePatrilineRootId)
        : 'dynasty:' + String(state.selectedDynastyId);
    }

    function currentManualPositionContextKey() {
      var layoutSuffix = state.mode === 'dynasty' ? ':' + String(state.dynastyLayoutMode || 'genealogical') : '';
      return state.mode + ':' + currentDynastyContextKey() + layoutSuffix;
    }

    function manualPositionsForCurrentContext() {
      var key = currentManualPositionContextKey();
      if (!manualNodePositionsByContext[key]) {
        manualNodePositionsByContext[key] = {};
      }
      return manualNodePositionsByContext[key];
    }

    function currentDynastyRegionLayout() {
      if (state.mode !== 'dynasty' || state.activePatrilineRootId != null) return null;
      var dynastyId = normalizeSelectedDynasty();
      if (dynastyId == null || dynastyId === 'all') return null;
      return dynastyRegionLayouts[String(dynastyId)] || null;
    }

    function hasCurrentDynastyRegionLayout() {
      var layout = currentDynastyRegionLayout();
      return !!(layout && layout.included_nodes && layout.included_nodes.length);
    }

    function pruneDynastyGraphToLayout(dynastyGraph, layout) {
      if (!layout) return dynastyGraph;
      var allowedIds = new Set();
      (layout.included_nodes || []).forEach(function(entry) {
        allowedIds.add(String(entry.id));
      });
      (layout.excluded_nodes || []).forEach(function(entry) {
        allowedIds.add(String(entry.id));
      });
      if (!allowedIds.size) return dynastyGraph;
      dynastyGraph.nodes = dynastyGraph.nodes.filter(function(node) {
        return allowedIds.has(String(node.id));
      });
      dynastyGraph.edges = dynastyGraph.edges.filter(function(edge) {
        return allowedIds.has(String(edge.from)) && allowedIds.has(String(edge.to));
      });
      return dynastyGraph;
    }

    function styleDynastyLayoutEdges(dynastyGraph) {
      dynastyGraph.edges.forEach(function(edge) {
        edge.smooth = false;
        if (edge.relation === 'father' || edge.relation === 'father_mother') {
          edge.color = { color: 'rgba(58,92,140,0.34)', highlight: 'rgba(36,64,105,0.68)' };
          edge.width = 1.2;
          edge.dashes = false;
        } else if (edge.relation === 'mother') {
          edge.color = { color: 'rgba(110,110,110,0.26)', highlight: 'rgba(75,75,75,0.6)' };
          edge.width = 0.9;
          edge.dashes = [4, 7];
        } else {
          edge.color = { color: 'rgba(90,90,90,0.22)', highlight: 'rgba(60,60,60,0.52)' };
          edge.width = 0.8;
        }
      });
    }

    function finalizePositionedDynastyNodes(dynastyGraph, includedById) {
      dynastyGraph.nodes.forEach(function(node) {
        if (!includedById[String(node.id)]) return;
        node.physics = false;
        node.fixed = { x: true, y: true };
        if (node.shape !== 'image') {
          node.borderWidth = Math.max(Number(node.borderWidth) || 1, 2);
          node.color = node.color || {};
          if (typeof node.color === 'string') {
            node.color = { background: node.color };
          }
          if (!node.color.border) node.color.border = '#355C7D';
        }
      });
      styleDynastyLayoutEdges(dynastyGraph);
    }

    function applyDynastyCentroidMapLayout(dynastyGraph, dynastyId) {
      var layout = dynastyRegionLayouts[String(dynastyId)];
      if (!layout || !layout.included_nodes || !layout.included_nodes.length) return false;
      pruneDynastyGraphToLayout(dynastyGraph, layout);

      var nodeById = {};
      dynastyGraph.nodes.forEach(function(node) {
        nodeById[String(node.id)] = node;
      });

      var includedById = {};
      var positioned = [];
      var minX = Infinity;
      var maxX = -Infinity;
      var minY = Infinity;
      var maxY = -Infinity;

      layout.included_nodes.forEach(function(entry) {
        var node = nodeById[String(entry.id)];
        var lon = Number(entry.centroid_lon);
        var lat = Number(entry.centroid_lat);
        if (!node || !isFinite(lon) || !isFinite(lat)) return;
        var projected = projectLonLatToOverview(lon, lat);
        positioned.push({
          entry: entry,
          node: node,
          x: projected.x,
          y: projected.y
        });
      });

      if (!positioned.length) return false;

      positioned.forEach(function(item) {
        var x = item.x;
        var y = item.y;
        item.node.x = x;
        item.node.y = y;
        item.node.physics = false;
        item.node.fixed = { x: true, y: true };
        includedById[String(item.entry.id)] = true;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      });

      var excludedNodes = dynastyGraph.nodes.filter(function(node) {
        return !includedById[String(node.id)];
      }).sort(function(a, b) {
        var roleA = String(a.node_role || '');
        var roleB = String(b.node_role || '');
        if (roleA !== roleB) return roleA.localeCompare(roleB);
        var labelA = String(a.label || a.id);
        var labelB = String(b.label || b.id);
        return labelA.localeCompare(labelB);
      });

      if (excludedNodes.length) {
        var columnGap = 210;
        var rowGap = 145;
        var maxRows = Math.max(8, Math.ceil(Math.sqrt(excludedNodes.length)));
        var startX = Math.max(maxX + 320, OVERVIEW_MAP_WIDTH * 0.55);
        var startY = minY;
        excludedNodes.forEach(function(node, index) {
          var col = Math.floor(index / maxRows);
          var row = index % maxRows;
          node.x = startX + col * columnGap;
          node.y = startY + row * rowGap;
          node.physics = false;
          node.fixed = { x: true, y: true };
        });
      }

      var manualPositions = manualPositionsForCurrentContext();
      Object.keys(manualPositions).forEach(function(nodeId) {
        var pos = manualPositions[nodeId];
        var node = nodeById[nodeId];
        if (!pos || !node) return;
        node.x = pos.x;
        node.y = pos.y;
        node.physics = false;
        node.fixed = { x: true, y: true };
      });

      finalizePositionedDynastyNodes(dynastyGraph, includedById);
      dynastyGraph.nodes.forEach(function(node) {
        if (!includedById[String(node.id)]) return;
        node.size = 1.5;
        node.borderWidth = 0.35;
        if (node.font) {
          node.font = Object.assign({}, node.font, { size: 1.0, strokeWidth: 0, vadjust: -4.5 });
        } else {
          node.font = { size: 1.0, strokeWidth: 0, vadjust: -4.5 };
        }
      });
      dynastyGraph.edges.forEach(function(edge) {
        edge.width = Math.max(0.12, (Number(edge.width) || 0.5) * 0.28);
        edge.arrows = {
          to: {
            enabled: true,
            scaleFactor: 0.06
          }
        };
      });
      dynastyGraph.centroidMapApplied = true;
      dynastyGraph.centroidMapExcludedCount = excludedNodes.length;
      return true;
    }

    function nodeDynastyIds(node) {
      if (!node) return [];
      if (Array.isArray(node.dynasty_ids) && node.dynasty_ids.length) {
        return node.dynasty_ids.map(function(id) { return String(id); });
      }
      if (node.dynasty_id != null && node.dynasty_id !== '') {
        return [String(node.dynasty_id)];
      }
      return [];
    }

    function nodeHasDynasty(node, dynastyId) {
      return nodeDynastyIds(node).indexOf(String(dynastyId)) !== -1;
    }

    setPersistedDynastyLayoutMode('genealogical');

    function buildOverviewNodes() {
      var DEG_TO_RAD = Math.PI / 180;
      var mapDimensions = activeOverviewMapDimensions();
      var mapWidth = mapDimensions.width;
      var mapHeight = mapDimensions.height;
      var EUROPE_MIN_LON = -8.9067;
      var EUROPE_MAX_LON = 72.9617;
      var EUROPE_MIN_LAT = 33.2307;
      var EUROPE_MAX_LAT = 58.9174;
      var mapBounds = {
        // Calibrated from the four visible SVG corners. Asia crosses the
        // international date line: its right edge is -179.97 (= 180.03 E).
        Asia: {
          minLon: 7.059670,
          maxLon: 180.028001,
          minLat: -13.889976,
          maxLat: 77.167475,
          wrapsDateline: true
        },
        'Greek Mythology': {
          minLon: 19.136220,
          maxLon: 29.950829,
          minLat: 34.561524,
          maxLat: 41.979569
        },
        Antiquity: {
          minLon: 11.660205,
          maxLon: 48.395864,
          minLat: 25.574254,
          maxLat: 42.938090
        }
      };

      function deterministicUnit(seed) {
        var x = Math.sin(seed * 12.9898) * 43758.5453;
        return x - Math.floor(x);
      }

      function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
      }

      function projectLonLatToOverview(lon, lat) {
        var latRad = lat * DEG_TO_RAD;
        var deltaLonRad = (lon - 10) * DEG_TO_RAD;
        var common = Math.pow(
          (
            1 +
            Math.sin(latRad) * Math.sin(52 * DEG_TO_RAD) +
            Math.cos(latRad) * Math.cos(52 * DEG_TO_RAD) * Math.cos(deltaLonRad)
          ) * 0.5,
          -0.5
        );
        var xPercent = 131.579 * (Math.cos(latRad) * Math.sin(deltaLonRad)) * common + 36.388;
        var yPercent = 55.11 - 153.610 * (
          Math.cos(52 * DEG_TO_RAD) * Math.sin(latRad) -
          Math.sin(52 * DEG_TO_RAD) * Math.cos(latRad) * Math.cos(deltaLonRad)
        ) * common;
        var xNorm = clamp(xPercent / 100, 0, 1);
        var yNorm = clamp(yPercent / 100, 0, 1);
        return {
          x: (xNorm - 0.5) * mapWidth,
          y: (yNorm - 0.5) * mapHeight
        };
      }

      function projectLonLatToMap(lon, lat) {
        if (state.overviewMap === 'Europe') return projectLonLatToOverview(lon, lat);
        var bounds = mapBounds[state.overviewMap] || mapBounds.Asia;
        // Keep locations immediately east of the date line on Asia's right
        // side rather than projecting them far to the west.
        if (bounds.wrapsDateline && lon < bounds.minLon) lon += 360;
        var x = clamp((lon - bounds.minLon) / (bounds.maxLon - bounds.minLon), 0, 1);
        var y = clamp(1 - (lat - bounds.minLat) / (bounds.maxLat - bounds.minLat), 0, 1);
        return {
          x: (x - 0.5) * mapWidth,
          y: (y - 0.5) * mapHeight
        };
      }

      function projectDynasty(dynasty) {
        var coordX = dynasty.coord_x;
        var coordY = dynasty.coord_y;

        if (typeof coordX === 'number' && typeof coordY === 'number' && isFinite(coordX) && isFinite(coordY)) {
          return projectLonLatToMap(coordY, coordX);
        }

        var idSeed = Number(dynasty.dynasty_id) || 0;
        var randX = deterministicUnit(idSeed + 17);
        var randY = deterministicUnit(idSeed + 53);
        var bounds = state.overviewMap === 'Europe'
          ? { minLon: EUROPE_MIN_LON, maxLon: EUROPE_MAX_LON, minLat: EUROPE_MIN_LAT, maxLat: EUROPE_MAX_LAT }
          : (mapBounds[state.overviewMap] || mapBounds.Asia);
        var fallbackLon = bounds.minLon + randX * (bounds.maxLon - bounds.minLon);
        var fallbackLat = bounds.minLat + randY * (bounds.maxLat - bounds.minLat);
        return projectLonLatToMap(fallbackLon, fallbackLat);
      }

      function resolveCollisions(entries) {
        var safeDistance = 9;
        var xLimit = mapWidth * 0.49;
        var yLimit = mapHeight * 0.49;
        var placed = [];
        var anchorGroups = {};

        entries.forEach(function(entry) {
          if (!entry.anchored) return;
          var key = entry.projected.x.toFixed(2) + ',' + entry.projected.y.toFixed(2);
          if (!anchorGroups[key]) anchorGroups[key] = [];
          anchorGroups[key].push(entry);
        });

        Object.keys(anchorGroups).forEach(function(key) {
          var group = anchorGroups[key];
          if (group.length <= 1) return;
          var center = group[0].projected;
          var baseRadius = 7;
          group.sort(function(a, b) {
            return Number(a.dynasty.dynasty_id || 0) - Number(b.dynasty.dynasty_id || 0);
          });
          group.forEach(function(entry, index) {
            var angle = (2 * Math.PI * index) / group.length - Math.PI / 2;
            var radius = baseRadius + Math.max(0, group.length - 2) * 1.2;
            entry.projected = {
              x: clamp(center.x + Math.cos(angle) * radius, -xLimit, xLimit),
              y: clamp(center.y + Math.sin(angle) * radius, -yLimit, yLimit)
            };
          });
        });

        entries.forEach(function(entry) {
          var baseX = entry.projected.x;
          var baseY = entry.projected.y;
          var seed = Number(entry.dynasty.dynasty_id) || 1;
          var angleBase = deterministicUnit(seed + 91) * Math.PI * 2;
          var resolved = { x: baseX, y: baseY };

          function isFarEnough(candidateX, candidateY) {
            return placed.every(function(other) {
              var dx = candidateX - other.x;
              var dy = candidateY - other.y;
              return Math.sqrt(dx * dx + dy * dy) >= safeDistance;
            });
          }

          if (!isFarEnough(baseX, baseY)) {
            var found = false;
            for (var step = 1; step <= 36 && !found; step += 1) {
              var radius = entry.anchored ? Math.ceil(step / 6) * 4 : Math.ceil(step / 8) * 10;
              var angle = angleBase + step * (Math.PI / 3);
              var candidateX = clamp(baseX + Math.cos(angle) * radius, -xLimit, xLimit);
              var candidateY = clamp(baseY + Math.sin(angle) * radius, -yLimit, yLimit);
              if (isFarEnough(candidateX, candidateY)) {
                resolved = { x: candidateX, y: candidateY };
                found = true;
              }
            }
          }

          entry.projected = resolved;
          placed.push(resolved);
        });

        return entries;
      }

      var overviewEntries = dynasties
        .filter(function(dynasty) {
          return normalizeOverviewMap(dynasty.map) === state.overviewMap;
        })
        .map(function(dynasty) {
          return {
            dynasty: dynasty,
            projected: projectDynasty(dynasty) || { x: 0, y: 0 },
            anchored: typeof dynasty.coord_x === 'number' && typeof dynasty.coord_y === 'number' && isFinite(dynasty.coord_x) && isFinite(dynasty.coord_y)
          };
        })
        .sort(function(a, b) {
          var rankA = a.dynasty.dynasty_rank != null ? a.dynasty.dynasty_rank : 999;
          var rankB = b.dynasty.dynasty_rank != null ? b.dynasty.dynasty_rank : 999;
          if (rankA !== rankB) return rankA - rankB;
          return String(a.dynasty.dynasty_name || '').localeCompare(String(b.dynasty.dynasty_name || ''));
        });

      resolveCollisions(overviewEntries);

      return overviewEntries.map(function(entry) {
        var dynasty = entry.dynasty;
        var projected = entry.projected;
        var markerScale = OVERVIEW_MARKER_SCALES[state.overviewMap] || OVERVIEW_MARKER_SCALES.Europe;
        var node = {
          id: 'dynasty:' + dynasty.dynasty_id,
          label: dynasty.dynasty_name,
          title: [
            'Dynasty: ' + dynasty.dynasty_name,
            'Members: ' + dynasty.member_count
          ].join('\n'),
          shape: dynasty.image_url ? 'image' : 'dot',
          image: dynasty.image_url || undefined,
          size: dynasty.image_url ? markerScale.image : markerScale.dot,
          font: {
            size: markerScale.font,
            face: 'Arial',
            vadjust: markerScale.vadjust,
            strokeWidth: 1,
            strokeColor: 'rgba(255,255,255,0.9)'
          },
          x: projected.x,
          y: projected.y,
          fixed: { x: true, y: true },
          color: dynasty.image_url ? undefined : '#d8c39a',
          isClusterNode: true,
          dynasty_id: dynasty.dynasty_id,
          dynasty_name: dynasty.dynasty_name,
          hidden: false
        };
        return node;
      });
    }

    function buildOverviewEdges() {
      var sourceEdges = dynastyEdges.filter(function(edge) {
        var from = dynastyById[String(edge.from)];
        var to = dynastyById[String(edge.to)];
        return from && to &&
          normalizeOverviewMap(from.map) === state.overviewMap &&
          normalizeOverviewMap(to.map) === state.overviewMap;
      });
      if (state.activeOverviewDynastyId != null) {
        sourceEdges = sourceEdges.filter(function(edge) {
          return String(edge.from) === String(state.activeOverviewDynastyId) ||
                 String(edge.to) === String(state.activeOverviewDynastyId);
        });
      } else {
        sourceEdges = [];
      }

      return sourceEdges.map(function(edge, index) {
        var fromDynasty = dynastyById[String(edge.from)];
        var toDynasty = dynastyById[String(edge.to)];
        var fromName = fromDynasty && fromDynasty.dynasty_name ? fromDynasty.dynasty_name : String(edge.from);
        var toName = toDynasty && toDynasty.dynasty_name ? toDynasty.dynasty_name : String(edge.to);
        var baseWidth = Math.max(0.18, Math.min(edge.weight * 0.12, 2.4));
        return {
          id: 'dynasty-edge:' + edge.from + ':' + edge.to,
          from: 'dynasty:' + edge.from,
          to: 'dynasty:' + edge.to,
          title: undefined,
          isOverviewEdge: true,
          chosen: false,
          overview_label: fromName + ' ↔ ' + toName,
          overview_count: edge.weight,
          overview_base_width: baseWidth,
          width: baseWidth,
          color: { color: '#7A7A7A', highlight: '#7A7A7A', hover: '#7A7A7A' },
          smooth: false
        };
      });
    }

    function refreshOverviewEdges() {
      if (state.mode !== 'overview') return;
      hideOverviewEdgeTooltip();
      edges.clear();
      edges.add(buildOverviewEdges());
    }

    function memberIdsForDynasty(dynastyId, includeMinor) {
      var dynasty = dynastyById[String(dynastyId)];
      if (!dynasty) return [];

      return originalNodes
        .filter(function(node) {
          return nodeHasDynasty(node, dynastyId);
        })
        .map(function(node) {
          return String(node.id);
        });
    }

    function rowYFromYear(year, fallbackIndex) {
      if (Number.isFinite(year)) {
        return (year - 1000) * 8;
      }
      return (fallbackIndex + 1) * 1800;
    }

    function decorateMaternalBridgeNode(node, relationType) {
      var copy = cloneNode(node, true);
      var sameDynasty = nodeHasDynasty(copy, state.selectedDynastyId || '');
      var relationLabel = relationType === 'father' ? 'Bridge father to dynasty' : 'Bridge mother to dynasty';
      var noDynastyLabel = relationType === 'father' ? 'Bridge father with no dynasty.' : 'Bridge mother with no dynasty.';

      copy.maternal_bridge = true;
      copy.bridge_node = true;
      copy.bridge_relation = relationType;
      copy.borderWidth = 3;
      // A bridge is a person, not a label-shaped box.  Keep the original round
      // marker when the person has no dynasty coat of arms.
      if (copy.shape !== 'image') copy.shape = 'dot';

      if (nodeDynastyIds(copy).length && !sameDynasty) {
        copy.color = {
          background: '#f3f4f6',
          border: '#111827',
          highlight: { background: '#f3f4f6', border: '#111827' }
        };
        copy.title = (copy.title || '') + '\n\n' + relationLabel + ': ' + (copy.dynasty_name || nodeDynastyIds(copy).join(', '));
      } else if (!nodeDynastyIds(copy).length) {
        copy.color = {
          background: '#e5e7eb',
          border: '#374151',
          highlight: { background: '#e5e7eb', border: '#374151' }
        };
        copy.title = (copy.title || '') + '\n\n' + noDynastyLabel;
      } else {
        copy.color = {
          background: '#f3f4f6',
          border: '#111827',
          highlight: { background: '#f3f4f6', border: '#111827' }
        };
      }

      return copy;
    }

    function decorateExpandedBranchNode(node) {
      var copy = cloneNode(node, true);
      copy.expanded_branch = true;
      copy.borderWidth = 2;
      copy.color = {
        background: '#eef2ff',
        border: '#4f46e5',
        highlight: { background: '#eef2ff', border: '#4f46e5' }
      };
      copy.title = (copy.title || '') + '\n\nExpanded ancestor node.';
      return copy;
    }

    function decorateDescendantNode(node) {
      var copy = cloneNode(node, true);
      copy.descendant_extension = true;
      copy.borderWidth = 2;
      copy.color = {
        background: '#f4efe1',
        border: '#9c7a2e',
        highlight: { background: '#f4efe1', border: '#9c7a2e' }
      };
      copy.title = (copy.title || '') + '\n\nChild of the active house root.';
      return copy;
    }

    function decorateExternalParentNode(node, relationType) {
      var copy = cloneNode(node, true);
      copy.external_root_parent = true;
      copy.external_parent_relation = relationType;
      copy.borderWidth = 3;
      copy.color = relationType === 'father'
        ? {
            background: '#e8eefb',
            border: '#4c6ea9',
            highlight: { background: '#e8eefb', border: '#4c6ea9' }
          }
        : {
            background: '#f0f2f5',
            border: '#6b7280',
            highlight: { background: '#f0f2f5', border: '#6b7280' }
          };
      copy.title = (copy.title || '') + '\n\nExternal root parent.';
      return copy;
    }

    function collectAncestorBranch(rootId, maxDepth) {
      var queue = [{ id: String(rootId), depth: 0 }];
      var visited = new Set([String(rootId)]);
      var nodeIds = [];
      var edgeKeys = [];
      var generationById = {};

      while (queue.length) {
        var item = queue.shift();
        if (item.depth >= maxDepth) continue;

        (parentEdgesByChild[item.id] || []).forEach(function(edge) {
          var parentId = String(edge.from);
          var relation = edge.relation || '';
          if (relation !== 'father' && relation !== 'mother' && relation !== 'father_mother') {
            return;
          }

          edgeKeys.push(parentId + '->' + item.id);
          if (!(parentId in generationById) || generationById[parentId] > item.depth + 1) {
            generationById[parentId] = item.depth + 1;
          }
          if (visited.has(parentId)) return;
          visited.add(parentId);
          nodeIds.push(parentId);
          queue.push({ id: parentId, depth: item.depth + 1 });
        });
      }

      return { nodeIds: nodeIds, edgeKeys: edgeKeys, generationById: generationById };
    }

    function toggleExpandedAncestors(nodeId) {
      var dynastyKey = currentDynastyContextKey();
      if (!state.expandedAncestorRoots[dynastyKey]) {
        state.expandedAncestorRoots[dynastyKey] = {};
      }
      if (state.expandedAncestorRoots[dynastyKey][String(nodeId)]) {
        delete state.expandedAncestorRoots[dynastyKey][String(nodeId)];
      } else {
        state.expandedAncestorRoots[dynastyKey][String(nodeId)] = true;
      }
    }

    function openPatrilinealView(nodeId) {
      var node = personNodeById[String(nodeId)];
      var dynastyIds = nodeDynastyIds(node);
      // The visible coat of arms uses the final dynasty ID.  Use that same
      // house for the action so its isolated JSON payload is loaded first.
      // This replaces, rather than extends, the previously opened house data.
      for (var index = dynastyIds.length - 1; index >= 0; index -= 1) {
        if (dynastyById[dynastyIds[index]]) {
          state.selectedDynastyId = dynastyIds[index];
          break;
        }
      }
      state.activePatrilineRootId = String(nodeId);
      state.selectedPersonId = null;
      state.mode = 'dynasty';
    }

    function collectPatrilinealCore(rootId) {
      var ids = [];
      var current = String(rootId);
      var visited = new Set();
      while (current && !visited.has(current) && personNodeById[current]) {
        visited.add(current);
        ids.push(current);
        current = fatherByChild[current] ? String(fatherByChild[current]) : null;
      }
      return ids;
    }

    function buildDynastySubgraph(dynastyId) {
      var includeMinor = !!state.showMinorNodes;
      var coreSourceIds = state.activePatrilineRootId != null
        ? collectPatrilinealCore(state.activePatrilineRootId)
        : memberIdsForDynasty(dynastyId, includeMinor);
      var coreIds = new Set(coreSourceIds);
      var selectedPerson = state.selectedPersonId != null ? String(state.selectedPersonId) : null;
      if (
        selectedPerson &&
        personNodeById[selectedPerson] &&
        (
          state.activePatrilineRootId != null
            ? coreIds.has(selectedPerson)
            : nodeHasDynasty(personNodeById[selectedPerson], dynastyId)
        )
      ) {
        coreIds.add(selectedPerson);
      }

      var bridgeIds = new Set();
      var bridgeRelationById = {};
      var externalRootParentIds = new Set();
      var externalRootParentsByChild = {};
      var expandedBranchRoots = state.expandedAncestorRoots[currentDynastyContextKey()] || {};
      var expandedBranchIds = new Set();
      var descendantIds = new Set();
      var visibleEdgeKeys = new Set();

      Object.keys(expandedBranchRoots).forEach(function(rootId) {
        if (!personNodeById[String(rootId)]) return;
        var branch = collectAncestorBranch(rootId, 3);
        branch.nodeIds.forEach(function(nodeId) {
          expandedBranchIds.add(String(nodeId));
        });
        branch.edgeKeys.forEach(function(edgeKey) {
          visibleEdgeKeys.add(edgeKey);
        });
      });

      if (state.activePatrilineRootId != null) {
        originalEdges.forEach(function(edge) {
          var relation = edge.relation || edge.title || '';
          if (String(edge.from) !== String(state.activePatrilineRootId)) return;
          if (relation !== 'mother' && relation !== 'father_mother' && relation !== 'father') return;
          descendantIds.add(String(edge.to));
          visibleEdgeKeys.add(String(edge.from) + '->' + String(edge.to));
        });
      }

      function compareNodeIds(aId, bId) {
        var a = personNodeById[String(aId)] || {};
        var b = personNodeById[String(bId)] || {};
        var ay = parseBirthYear(a);
        var by = parseBirthYear(b);
        if (Number.isFinite(ay) && Number.isFinite(by) && ay !== by) return ay - by;
        if (Number.isFinite(ay) && !Number.isFinite(by)) return -1;
        if (!Number.isFinite(ay) && Number.isFinite(by)) return 1;
        return String(a.label || a.id || aId).localeCompare(String(b.label || b.id || bId));
      }

      function nodeIsLikelyFemale(nodeId) {
        var node = personNodeById[String(nodeId)] || {};
        var label = String(node.label || '').toLowerCase();
        var titles = String(node.titles || '').toLowerCase();
        if (
          titles.indexOf('queen') !== -1 ||
          titles.indexOf('empress') !== -1 ||
          titles.indexOf('duchess') !== -1 ||
          titles.indexOf('countess') !== -1 ||
          titles.indexOf('princess') !== -1 ||
          titles.indexOf('lady') !== -1 ||
          titles.indexOf('baroness') !== -1
        ) {
          return true;
        }

        var femaleNameHints = [
          'agnes', 'alice', 'alida', 'alix', 'amadea', 'ana', 'anna', 'anne',
          'beatrice', 'bertha', 'bianca', 'blanche', 'bona', 'bonne',
          'caterina', 'catherine', 'charlotte', 'claudine', 'constance',
          'eleanor', 'elisabeth', 'elizabeth', 'emma', 'ermengarde', 'isabel',
          'isabella', 'joan', 'joanna', 'jolande', 'jane', 'margaret',
          'marguerite', 'margherita', 'maria', 'marie', 'mary', 'maud',
          'matilda', 'philippa', 'renee', 'sibyl', 'sybille', 'violante',
          'yolande'
        ];
        if (femaleNameHints.some(function(name) { return label.indexOf(name) === 0; })) {
          return true;
        }

        return originalEdges.some(function(edge) {
          var relation = edge.relation || edge.title || '';
          return String(edge.from) === String(nodeId) && relation === 'mother';
        });
      }

      var biologicalFatherByChild = {};
      var biologicalMotherByChild = {};
      var biologicalChildrenByMother = {};
      originalEdges.forEach(function(edge) {
        var relation = edge.relation || edge.title || '';
        var parentId = String(edge.from);
        var childId = String(edge.to);
        if (!coreIds.has(childId)) return;
        if (relation === 'father' || relation === 'father_mother') {
          biologicalFatherByChild[childId] = parentId;
        }
        if (relation === 'mother' || relation === 'father_mother') {
          biologicalMotherByChild[childId] = parentId;
          if (!biologicalChildrenByMother[parentId]) {
            biologicalChildrenByMother[parentId] = [];
          }
          biologicalChildrenByMother[parentId].push(childId);
        }
      });

      function parentCarriesSelectedDynasty(parentId) {
        parentId = String(parentId);
        if (!coreIds.has(parentId)) return false;
        var parentNode = personNodeById[parentId];
        return !!(parentNode && nodeHasDynasty(parentNode, dynastyId));
      }

      var fatherInCoreByChild = {};
      var childrenByFather = {};
      var motherByChild = {};
      var lineageModeByChild = {};

      Array.from(coreIds).forEach(function(childId) {
        childId = String(childId);
        var biologicalFatherId = biologicalFatherByChild[childId] ? String(biologicalFatherByChild[childId]) : null;
        var biologicalMotherId = biologicalMotherByChild[childId] ? String(biologicalMotherByChild[childId]) : null;
        var fatherInCore = biologicalFatherId && coreIds.has(biologicalFatherId) ? biologicalFatherId : null;
        var motherInCore = biologicalMotherId && coreIds.has(biologicalMotherId) ? biologicalMotherId : null;
        var fatherCarriesDynasty = fatherInCore && parentCarriesSelectedDynasty(fatherInCore);
        var motherCarriesDynasty = motherInCore && parentCarriesSelectedDynasty(motherInCore);
        var childDynastyIds = nodeDynastyIds(personNodeById[childId]);
        var fatherDynastyIds = fatherInCore ? nodeDynastyIds(personNodeById[fatherInCore]) : [];
        var selectedDynastyText = String(dynastyId);
        var childRetainsFatherDynasty = !!(
          fatherInCore &&
          fatherDynastyIds.some(function(id) { return childDynastyIds.indexOf(String(id)) !== -1; })
        );
        var motherAddsSelectedDynasty = !!(
          motherCarriesDynasty &&
          childDynastyIds.indexOf(selectedDynastyText) !== -1 &&
          fatherDynastyIds.indexOf(selectedDynastyText) === -1
        );
        var strictMaternalTransmission = !!(
          motherInCore &&
          fatherInCore &&
          !fatherCarriesDynasty &&
          childRetainsFatherDynasty &&
          motherAddsSelectedDynasty
        );

        var carrierParentId = null;
        if (strictMaternalTransmission) {
          carrierParentId = motherInCore;
          lineageModeByChild[childId] = 'maternal';
        } else if (fatherCarriesDynasty) {
          carrierParentId = fatherInCore;
          lineageModeByChild[childId] = 'paternal';
        } else if (motherCarriesDynasty && !fatherInCore) {
          carrierParentId = motherInCore;
          lineageModeByChild[childId] = 'maternal';
        } else if (fatherInCore) {
          carrierParentId = fatherInCore;
          lineageModeByChild[childId] = 'paternal';
        } else if (motherInCore) {
          carrierParentId = motherInCore;
          lineageModeByChild[childId] = 'maternal';
        }

        if (carrierParentId) {
          fatherInCoreByChild[childId] = carrierParentId;
          if (!childrenByFather[carrierParentId]) childrenByFather[carrierParentId] = [];
          childrenByFather[carrierParentId].push(childId);
        }

        if (carrierParentId) {
          var spouseParentId = biologicalFatherId === carrierParentId ? biologicalMotherId : biologicalFatherId;
          if (spouseParentId) {
            motherByChild[childId] = String(spouseParentId);
          }
        }
      });

      originalEdges.forEach(function(edge) {
        var childId = String(edge.to);
        var parentId = String(edge.from);
        if (!coreIds.has(childId)) return;

        if (fatherInCoreByChild[childId] && parentId === String(fatherInCoreByChild[childId])) {
          if (coreIds.has(parentId)) {
            visibleEdgeKeys.add(parentId + '->' + childId);
          }
          return;
        }

        if (motherByChild[childId] && parentId === String(motherByChild[childId])) {
          if (coreIds.has(parentId)) {
            visibleEdgeKeys.add(parentId + '->' + childId);
          } else if (state.showMaternalBridges) {
            bridgeIds.add(parentId);
            bridgeRelationById[parentId] =
              lineageModeByChild[childId] === 'maternal' ? 'father' : 'mother';
            visibleEdgeKeys.add(parentId + '->' + childId);
          }
        }
      });

      var subNodes = [];
      var coreNodes = [];
      originalNodes.forEach(function(node) {
        var nodeId = String(node.id);
        if (coreIds.has(nodeId)) {
          var coreNode = cloneNode(node, true);
          coreNode.core_dynasty_node = true;
          coreNode.lineage_mode = lineageModeByChild[nodeId] || null;
          coreNodes.push(coreNode);
          subNodes.push(coreNode);
        } else if (bridgeIds.has(nodeId)) {
          subNodes.push(decorateMaternalBridgeNode(node, bridgeRelationById[nodeId] || 'mother'));
        } else if (expandedBranchIds.has(nodeId)) {
          subNodes.push(decorateExpandedBranchNode(node));
        } else if (descendantIds.has(nodeId)) {
          subNodes.push(decorateDescendantNode(node));
        }
      });

      var coreNodeById = {};
      coreNodes.forEach(function(node) {
        coreNodeById[String(node.id)] = node;
      });

      var childGroupsByFather = {};
      Object.keys(childrenByFather).forEach(function(parentId) {
        var groupsByMother = {};
        (childrenByFather[parentId] || []).forEach(function(childId) {
          var motherId = motherByChild[String(childId)] || '__unknown__';
          if (!groupsByMother[motherId]) groupsByMother[motherId] = [];
          groupsByMother[motherId].push(String(childId));
        });

        var groups = Object.keys(groupsByMother).map(function(motherId) {
          var children = groupsByMother[motherId].slice().sort(compareNodeIds);
          var leafDaughters = children.filter(function(childId) {
            var childChildren = (childrenByFather[String(childId)] || []).filter(function(grandChildId) {
              return coreIds.has(String(grandChildId));
            });
            return childChildren.length === 0 && nodeIsLikelyFemale(childId);
          });
          var mainChildren = children.filter(function(childId) {
            return leafDaughters.indexOf(childId) === -1;
          });
          return {
            motherId: motherId,
            children: children,
            leafDaughters: leafDaughters,
            mainChildren: mainChildren,
            sortAnchor: children[0]
          };
        }).sort(function(a, b) {
          return compareNodeIds(a.sortAnchor, b.sortAnchor);
        });

        childGroupsByFather[parentId] = groups;
        childrenByFather[parentId] = groups.reduce(function(acc, group) {
          return acc.concat(group.mainChildren);
        }, []);
      });

      var maleLineLengthById = {};
      function longestMaleLineFrom(nodeId) {
        nodeId = String(nodeId);
        if (maleLineLengthById[nodeId] != null) {
          return maleLineLengthById[nodeId];
        }
        var continuationChildren = (childGroupsByFather[nodeId] || []).reduce(function(acc, group) {
          return acc.concat(group.mainChildren.map(function(childId) { return String(childId); }));
        }, []);
        if (!continuationChildren.length) {
          maleLineLengthById[nodeId] = 1;
          return 1;
        }
        var bestChildLine = continuationChildren.reduce(function(best, childId) {
          return Math.max(best, longestMaleLineFrom(childId));
        }, 0);
        maleLineLengthById[nodeId] = 1 + bestChildLine;
        return maleLineLengthById[nodeId];
      }

      Array.from(coreIds).forEach(function(nodeId) {
        longestMaleLineFrom(nodeId);
      });

      var rootIds = Array.from(coreIds).filter(function(nodeId) {
        return !fatherInCoreByChild[String(nodeId)];
      }).sort(compareNodeIds);

      var leafDaughterCoreIds = new Set();
      Array.from(coreIds).forEach(function(nodeId) {
        nodeId = String(nodeId);
        if (!nodeIsLikelyFemale(nodeId)) return;
        var hasMaleLineCoreChildren = (childGroupsByFather[nodeId] || []).some(function(group) {
          return group.mainChildren.length > 0;
        });
        if (!hasMaleLineCoreChildren) {
          leafDaughterCoreIds.add(nodeId);
        }
      });

      // Placement-only exception: if a woman is otherwise a daughter in this
      // house but has a child with a core brother, display her as that
      // brother's wife. The carrier-line graph above remains unchanged.
      var siblingHusbandByWife = {};
      Object.keys(biologicalMotherByChild).forEach(function(childId) {
        var wifeId = String(biologicalMotherByChild[childId]);
        var husbandId = biologicalFatherByChild[childId]
          ? String(biologicalFatherByChild[childId])
          : null;
        if (!husbandId || !leafDaughterCoreIds.has(wifeId) || !coreIds.has(husbandId)) return;

        var wifeFatherId = biologicalFatherByChild[wifeId] ? String(biologicalFatherByChild[wifeId]) : null;
        var wifeMotherId = biologicalMotherByChild[wifeId] ? String(biologicalMotherByChild[wifeId]) : null;
        var husbandFatherId = biologicalFatherByChild[husbandId] ? String(biologicalFatherByChild[husbandId]) : null;
        var husbandMotherId = biologicalMotherByChild[husbandId] ? String(biologicalMotherByChild[husbandId]) : null;
        var shareParent = !!(
          (wifeFatherId && (wifeFatherId === husbandFatherId || wifeFatherId === husbandMotherId)) ||
          (wifeMotherId && (wifeMotherId === husbandFatherId || wifeMotherId === husbandMotherId))
        );
        if (shareParent && !siblingHusbandByWife[wifeId]) {
          siblingHusbandByWife[wifeId] = husbandId;
        }
      });
      Object.keys(siblingHusbandByWife).forEach(function(wifeId) {
        leafDaughterCoreIds.delete(wifeId);
      });

      function buildMaleLineChains() {
        // Greedily extract non-overlapping carrier paths.  The first path is
        // the longest available line, then its nodes are removed before the
        // next line is selected.  This is deliberately different from ranking
        // precomputed, overlapping paths: each person belongs to one line.
        var remaining = new Set(Array.from(coreIds).map(String).filter(function(nodeId) {
          return !leafDaughterCoreIds.has(nodeId) && !siblingHusbandByWife[nodeId];
        }));
        var rankedChains = [];
        var assignedColumn = {};

        function longestRemainingPath(startId, visiting) {
          startId = String(startId);
          if (!remaining.has(startId) || visiting.has(startId)) return [];
          var nextVisiting = new Set(visiting);
          nextVisiting.add(startId);
          var bestTail = [];
          (childGroupsByFather[startId] || []).forEach(function(group) {
            group.mainChildren.forEach(function(childId) {
              childId = String(childId);
              var tail = longestRemainingPath(childId, nextVisiting);
              if (
                tail.length > bestTail.length ||
                (tail.length === bestTail.length && tail.length && compareNodeIds(tail[0], bestTail[0]) < 0)
              ) {
                bestTail = tail;
              }
            });
          });
          return [startId].concat(bestTail);
        }

        while (remaining.size) {
          var best = [];
          Array.from(remaining).sort(compareNodeIds).forEach(function(startId) {
            var candidate = longestRemainingPath(startId, new Set());
            if (
              candidate.length > best.length ||
              (candidate.length === best.length && candidate.length && compareNodeIds(candidate[0], best[0]) < 0)
            ) {
              best = candidate;
            }
          });
          if (!best.length) break;
          best.forEach(function(id) {
            assignedColumn[id] = rankedChains.length;
            remaining.delete(id);
          });
          rankedChains.push(best);
        }

        var chainMeta = rankedChains.map(function(chain, chainIndex) {
          var startId = chain.length ? String(chain[0]) : null;
          var originNodeId = startId ? fatherInCoreByChild[startId] || null : null;
          var originChainIndex = null;
          if (
            originNodeId != null &&
            assignedColumn[String(originNodeId)] != null &&
            assignedColumn[String(originNodeId)] !== chainIndex
          ) {
            originChainIndex = assignedColumn[String(originNodeId)];
          }
          return {
            chainIndex: chainIndex,
            startId: startId,
            originNodeId: originNodeId,
            originChainIndex: originChainIndex
          };
        });

        return { chains: rankedChains, assignedColumn: assignedColumn, chainMeta: chainMeta };
      }

      var maleLineData = buildMaleLineChains();
      var maleLineChains = maleLineData.chains;
      var nodeChainIndex = maleLineData.assignedColumn;
      var chainMetaByIndex = maleLineData.chainMeta || [];

      originalEdges.forEach(function(edge) {
        var childId = String(edge.to);
        var parentId = String(edge.from);
        if (rootIds.indexOf(childId) === -1 || coreIds.has(parentId)) return;
        var relation = edge.relation || edge.title || '';
        if (relation !== 'father' && relation !== 'mother' && relation !== 'father_mother') return;
        if (!externalRootParentsByChild[childId]) {
          externalRootParentsByChild[childId] = {};
        }
        if (relation === 'father' || relation === 'father_mother') {
          externalRootParentsByChild[childId].father = parentId;
          externalRootParentIds.add(parentId);
          visibleEdgeKeys.add(parentId + '->' + childId);
        }
        if (relation === 'mother' || relation === 'father_mother') {
          externalRootParentsByChild[childId].mother = parentId;
          externalRootParentIds.add(parentId);
          visibleEdgeKeys.add(parentId + '->' + childId);
        }
      });

      originalNodes.forEach(function(node) {
        var nodeId = String(node.id);
        if (!externalRootParentIds.has(nodeId)) return;
        if (subNodes.some(function(existing) { return String(existing.id) === nodeId; })) return;
        var relationType = 'mother';
        rootIds.some(function(rootId) {
          var pair = externalRootParentsByChild[String(rootId)] || {};
          if (pair.father === nodeId) {
            relationType = 'father';
            return true;
          }
          if (pair.mother === nodeId) {
            relationType = 'mother';
            return true;
          }
          return false;
        });
        subNodes.push(decorateExternalParentNode(node, relationType));
      });

      var horizontalSpacing = 220;
      var verticalSpacing = 180;
      var wifeXOffset = 220;
      var chainColumnGap = 36;
      var corePositionById = {};
      var bridgePositionById = {};

      function estimateNodeFootprint(nodeId) {
        var node = personNodeById[String(nodeId)] || {};
        var label = String(node.label || node.name || nodeId || '');
        return Math.max(150, Math.min(320, 90 + label.length * 4.5));
      }

      function minimumGapBetween(leftNodeId, rightNodeId) {
        return (estimateNodeFootprint(leftNodeId) + estimateNodeFootprint(rightNodeId)) / 2 + 16;
      }

      function computeDaughterBlock(fatherX, daughterIds) {
        var placements = [];
        var currentX = fatherX - wifeXOffset;
        var previousWidth = null;
        daughterIds.forEach(function(nodeId, index) {
          var width = estimateNodeFootprint(String(nodeId));
          if (index > 0) {
            currentX = currentX - (previousWidth + width) / 2 - 20;
          }
          placements.push({ nodeId: String(nodeId), x: currentX, width: width });
          previousWidth = width;
        });
        var left = Infinity;
        var right = -Infinity;
        placements.forEach(function(item) {
          left = Math.min(left, item.x - item.width / 2);
          right = Math.max(right, item.x + item.width / 2);
        });
        return { placements: placements, left: left, right: right };
      }

      function computeWifeBlock(startX, wives) {
        var positions = [];
        var currentX = startX;
        wives.forEach(function(item, index) {
          // Recursive placement uses `nodeId`; the legacy placement uses
          // `motherId`. Accept both so a core daughter promoted to a wife is
          // stored under her actual id rather than an `undefined` bridge.
          var wifeId = item.motherId != null ? item.motherId : item.nodeId;
          if (index > 0) currentX = currentX + positions[index - 1].width / 2 + item.width / 2 + 24;
          positions.push({
            motherId: wifeId,
            node: item.node,
            width: item.width,
            x: currentX
          });
        });
        var left = Infinity;
        var right = -Infinity;
        positions.forEach(function(item) {
          left = Math.min(left, item.x - item.width / 2);
          right = Math.max(right, item.x + item.width / 2);
        });
        return { positions: positions, left: left, right: right };
      }

      var coreChildrenByFather = {};
      Array.from(coreIds).forEach(function(nodeId) {
        var orderedChildren = (childGroupsByFather[String(nodeId)] || []).reduce(function(acc, group) {
          return acc.concat(
            group.leafDaughters.map(function(childId) { return String(childId); }),
            group.mainChildren.map(function(childId) { return String(childId); })
          );
        }, []);
        if (orderedChildren.length) {
          coreChildrenByFather[String(nodeId)] = orderedChildren;
        }
      });

      var depthById = {};
      rootIds.forEach(function(rootId) {
        depthById[String(rootId)] = 0;
      });
      var bfsQueue = rootIds.map(function(id) { return String(id); });
      var bfsHead = 0;
      while (bfsHead < bfsQueue.length) {
        var bfsCurrent = bfsQueue[bfsHead++];
        var bfsDepth = depthById[bfsCurrent];
        (coreChildrenByFather[bfsCurrent] || []).forEach(function(childId) {
          childId = String(childId);
          var newDepth = bfsDepth + 1;
          if (depthById[childId] == null || depthById[childId] < newDepth) {
            depthById[childId] = newDepth;
            bfsQueue.push(childId);
          }
        });
      }
      Array.from(coreIds).forEach(function(nodeId) {
        nodeId = String(nodeId);
        if (depthById[nodeId] == null) depthById[nodeId] = 0;
      });

      var maxDepth = 0;
      Array.from(coreIds).forEach(function(nodeId) {
        nodeId = String(nodeId);
        if (depthById[nodeId] > maxDepth) maxDepth = depthById[nodeId];
      });

      var coreLayers = {};
      for (var li = 0; li <= maxDepth; li += 1) {
        coreLayers[li] = [];
      }
      Array.from(coreIds).forEach(function(nodeId) {
        nodeId = String(nodeId);
        coreLayers[depthById[nodeId]].push(nodeId);
      });
      for (var layerIndex = 0; layerIndex <= maxDepth; layerIndex += 1) {
        coreLayers[layerIndex].sort(compareNodeIds);
      }

      var coreChildrenByMother = {};
      Object.keys(motherByChild).forEach(function(childId) {
        childId = String(childId);
        if (!coreIds.has(childId)) return;
        var bridgeParentId = String(motherByChild[childId]);
        if (!bridgeIds.has(bridgeParentId)) return;
        if (!coreChildrenByMother[bridgeParentId]) coreChildrenByMother[bridgeParentId] = [];
        coreChildrenByMother[bridgeParentId].push(childId);
      });

      function selectLikelyHusbandId(motherId, visibleChildren) {
        function chooseBestFatherId(countsByFather) {
          var bestFatherId = null;
          var bestCount = 0;
          var bestDepth = Infinity;
          Object.keys(countsByFather).forEach(function(fid) {
            var count = countsByFather[fid];
            var depth = depthById[String(fid)] != null ? depthById[String(fid)] : Infinity;
            if (
              count > bestCount ||
              (count === bestCount && depth < bestDepth) ||
              (count === bestCount && depth === bestDepth && bestFatherId != null && compareNodeIds(fid, bestFatherId) < 0)
            ) {
              bestCount = count;
              bestFatherId = fid;
              bestDepth = depth;
            }
          });
          return bestFatherId;
        }

        if (visibleChildren && visibleChildren.length) {
          var fatherChildCount = {};
          visibleChildren.forEach(function(childId) {
            var fid = fatherInCoreByChild[String(childId)];
            if (!fid) return;
            fatherChildCount[fid] = (fatherChildCount[fid] || 0) + 1;
          });
          var bestVisibleFatherId = chooseBestFatherId(fatherChildCount);
          if (bestVisibleFatherId) return bestVisibleFatherId;
        }

        var fallbackCounts = {};
        originalEdges.forEach(function(edge) {
          var relation = edge.relation || edge.title || '';
          if ((relation === 'mother' || relation === 'father_mother') && String(edge.from) === String(motherId)) {
            var fid = fatherInCoreByChild[String(edge.to)];
            if (fid) {
              fallbackCounts[fid] = (fallbackCounts[fid] || 0) + 1;
            }
          }
        });
        return chooseBestFatherId(fallbackCounts);
      }

      var daughterGroupsByFather = {};
      Array.from(leafDaughterCoreIds).sort(compareNodeIds).forEach(function(nodeId) {
        nodeId = String(nodeId);
        var fatherId = fatherInCoreByChild[nodeId];
        if (!fatherId) return;
        if (!daughterGroupsByFather[fatherId]) daughterGroupsByFather[fatherId] = [];
        daughterGroupsByFather[fatherId].push(nodeId);
      });

      // Keep the former column layout below as a fallback while this layout is
      // tuned.  The recursive packer is intentionally self-contained: it
      // receives carrier lines and emits only final node coordinates.
      var USE_RECURSIVE_BRANCH_PACKING = true;

      if (USE_RECURSIVE_BRANCH_PACKING) {
        var branchGap = 28;
        var wifeGroupsForLayout = {};
        subNodes.forEach(function(node) {
          var wifeId = String(node.id);
          if (!node.maternal_bridge && !siblingHusbandByWife[wifeId]) return;
          var husbandId = siblingHusbandByWife[wifeId] ||
            selectLikelyHusbandId(wifeId, coreChildrenByMother[wifeId] || []);
          if (!husbandId) return;
          husbandId = String(husbandId);
          if (!wifeGroupsForLayout[husbandId]) wifeGroupsForLayout[husbandId] = [];
          wifeGroupsForLayout[husbandId].push({
            node: node,
            nodeId: wifeId,
            width: estimateNodeFootprint(wifeId)
          });
        });
        Object.keys(wifeGroupsForLayout).forEach(function(husbandId) {
          wifeGroupsForLayout[husbandId].sort(function(a, b) {
            return compareNodeIds(a.nodeId, b.nodeId);
          });
        });

        var childLinesByParentLine = {};
        var topLevelLineIndices = [];
        chainMetaByIndex.forEach(function(meta) {
          if (!meta || meta.chainIndex === 0) return;
          if (meta.originChainIndex == null) {
            topLevelLineIndices.push(meta.chainIndex);
            return;
          }
          if (!childLinesByParentLine[meta.originChainIndex]) {
            childLinesByParentLine[meta.originChainIndex] = [];
          }
          childLinesByParentLine[meta.originChainIndex].push(meta.chainIndex);
        });

        var branchNodeCountByLine = {};
        function totalNodesInBranch(lineIndex, visiting) {
          if (branchNodeCountByLine[lineIndex] != null) return branchNodeCountByLine[lineIndex];
          if (visiting.has(lineIndex)) return 0;
          var nextVisiting = new Set(visiting);
          nextVisiting.add(lineIndex);
          var total = 0;
          (maleLineChains[lineIndex] || []).forEach(function(nodeId) {
            nodeId = String(nodeId);
            total += 1;
            total += (daughterGroupsByFather[nodeId] || []).length;
            total += (wifeGroupsForLayout[nodeId] || []).length;
          });
          (childLinesByParentLine[lineIndex] || []).forEach(function(childLineIndex) {
            total += totalNodesInBranch(childLineIndex, nextVisiting);
          });
          branchNodeCountByLine[lineIndex] = total;
          return total;
        }

        function compareLineIndices(a, b) {
          var aTotal = totalNodesInBranch(a, new Set());
          var bTotal = totalNodesInBranch(b, new Set());
          if (aTotal !== bTotal) return bTotal - aTotal;
          var aStart = maleLineChains[a] && maleLineChains[a][0];
          var bStart = maleLineChains[b] && maleLineChains[b][0];
          if (aStart != null && bStart != null) return compareNodeIds(aStart, bStart);
          return a - b;
        }

        Object.keys(childLinesByParentLine).forEach(function(lineIndex) {
          childLinesByParentLine[lineIndex].sort(compareLineIndices);
        });
        topLevelLineIndices.sort(compareLineIndices);

        function createEmptyBranch(lineIndex) {
          return {
            lineIndex: lineIndex,
            nodes: {},
            bridges: {},
            rectangles: [],
            lineAreas: [],
            left: Infinity,
            right: -Infinity,
            top: Infinity,
            bottom: -Infinity,
            anchorX: 0,
            anchorY: 0,
            longestLine: (maleLineChains[lineIndex] || []).length
          };
        }

        function includeRectangle(branch, rectangle) {
          branch.rectangles.push(rectangle);
          branch.left = Math.min(branch.left, rectangle.left);
          branch.right = Math.max(branch.right, rectangle.right);
          branch.top = Math.min(branch.top, rectangle.top);
          branch.bottom = Math.max(branch.bottom, rectangle.bottom);
        }

        function includeNode(branch, nodeId, x, y, isBridge) {
          var width = estimateNodeFootprint(nodeId);
          var position = { x: x, y: y, width: width };
          if (isBridge) {
            branch.bridges[String(nodeId)] = position;
          } else {
            branch.nodes[String(nodeId)] = position;
          }
          includeRectangle(branch, {
            left: x - width / 2,
            right: x + width / 2,
            top: y - verticalSpacing * 0.18,
            bottom: y + verticalSpacing * 0.18
          });
        }

        function translateBranch(branch, deltaX, deltaY) {
          Object.keys(branch.nodes).forEach(function(nodeId) {
            branch.nodes[nodeId].x += deltaX;
            branch.nodes[nodeId].y += deltaY;
          });
          Object.keys(branch.bridges).forEach(function(nodeId) {
            branch.bridges[nodeId].x += deltaX;
            branch.bridges[nodeId].y += deltaY;
          });
          branch.rectangles.forEach(function(rectangle) {
            rectangle.left += deltaX;
            rectangle.right += deltaX;
            rectangle.top += deltaY;
            rectangle.bottom += deltaY;
          });
          branch.lineAreas.forEach(function(area) {
            area.left += deltaX;
            area.right += deltaX;
            area.top += deltaY;
            area.bottom += deltaY;
          });
          branch.left += deltaX;
          branch.right += deltaX;
          branch.top += deltaY;
          branch.bottom += deltaY;
        }

        function absorbBranch(target, source) {
          Object.keys(source.nodes).forEach(function(nodeId) {
            target.nodes[nodeId] = source.nodes[nodeId];
          });
          Object.keys(source.bridges).forEach(function(nodeId) {
            target.bridges[nodeId] = source.bridges[nodeId];
          });
          source.rectangles.forEach(function(rectangle) {
            includeRectangle(target, rectangle);
          });
          source.lineAreas.forEach(function(area) {
            target.lineAreas.push(area);
          });
          target.longestLine = Math.max(target.longestLine, source.longestLine);
        }

        function rectanglesOverlap(a, b) {
          return !(
            a.right + branchGap <= b.left ||
            a.left >= b.right + branchGap ||
            a.bottom + branchGap <= b.top ||
            a.top >= b.bottom + branchGap
          );
        }

        function translatedRectangles(branch, deltaX, deltaY) {
          return branch.rectangles.map(function(rectangle) {
            return {
              left: rectangle.left + deltaX,
              right: rectangle.right + deltaX,
              top: rectangle.top + deltaY,
              bottom: rectangle.bottom + deltaY
            };
          });
        }

        function intersectsBranch(branch, target, deltaX, deltaY) {
          var rectangles = translatedRectangles(branch, deltaX, deltaY);
          return rectangles.some(function(candidate) {
            return target.rectangles.some(function(occupied) {
              return rectanglesOverlap(candidate, occupied);
            });
          });
        }

        function nearestFreeBranchX(branch, target, targetY, side, preferredX) {
          // Align the branch's first carrier with the child-generation row of
          // the node from which it branches, rather than aligning its box edge.
          var deltaY = targetY - branch.anchorY;

          // First reuse a column occupied by an individual carrier line.  A
          // composite branch may be wide because of distant side branches, but
          // a new branch can still safely share one of its internal columns if
          // its entire rectangle fits at this vertical interval.
          var reusableAreas = target.lineAreas.slice().sort(function(a, b) {
            var aCenter = (a.left + a.right) / 2;
            var bCenter = (b.left + b.right) / 2;
            var aDistance = Math.abs(aCenter - preferredX);
            var bDistance = Math.abs(bCenter - preferredX);
            if (aDistance !== bDistance) return aDistance - bDistance;
            return a.lineIndex - b.lineIndex;
          });
          for (var areaIndex = 0; areaIndex < reusableAreas.length; areaIndex += 1) {
            var area = reusableAreas[areaIndex];
            var areaCenter = (area.left + area.right) / 2;
            var reusedColumnX = areaCenter - branch.anchorX;
            if (!intersectsBranch(branch, target, reusedColumnX, deltaY)) {
              return { x: reusedColumnX, y: deltaY };
            }
          }

          var candidateX = side === 'left'
            ? target.left - branchGap - branch.right
            : target.right + branchGap - branch.left;
          var guard = 0;
          while (intersectsBranch(branch, target, candidateX, deltaY) && guard < 200) {
            var conflicting = translatedRectangles(branch, candidateX, deltaY).reduce(function(found, rect) {
              if (found) return found;
              return target.rectangles.find(function(occupied) {
                return rectanglesOverlap(rect, occupied);
              }) || null;
            }, null);
            if (!conflicting) break;
            if (side === 'left') {
              candidateX = Math.min(candidateX, conflicting.left - branchGap - branch.right);
            } else {
              candidateX = Math.max(candidateX, conflicting.right + branchGap - branch.left);
            }
            guard += 1;
          }
          return { x: candidateX, y: deltaY };
        }

        var buildingLines = new Set();
        var completedLayouts = {};
        function buildBranchLayout(lineIndex) {
          if (completedLayouts[lineIndex]) return completedLayouts[lineIndex];
          if (buildingLines.has(lineIndex)) return createEmptyBranch(lineIndex);
          buildingLines.add(lineIndex);

          var branch = createEmptyBranch(lineIndex);
          var line = maleLineChains[lineIndex] || [];
          line.forEach(function(nodeId, nodeIndex) {
            nodeId = String(nodeId);
            var y = nodeIndex * verticalSpacing;
            includeNode(branch, nodeId, 0, y, false);

            var daughterIds = (daughterGroupsByFather[nodeId] || []).slice().sort(compareNodeIds);
            if (daughterIds.length) {
              var daughterBlock = computeDaughterBlock(0, daughterIds);
              daughterBlock.placements.forEach(function(item) {
                includeNode(branch, item.nodeId, item.x, y + verticalSpacing, false);
              });
            }

            var wives = wifeGroupsForLayout[nodeId] || [];
            if (wives.length) {
              var wifeBlock = computeWifeBlock(wifeXOffset, wives);
              wifeBlock.positions.forEach(function(item) {
                includeNode(branch, item.motherId, item.x, y, true);
              });
            }
          });

          // This rectangle deliberately covers only this carrier line and its
          // directly attached wives/daughters.  Descendant branches contribute
          // their own line rectangles after they are merged below.
          var localLineRectangles = branch.rectangles.slice();
          if (localLineRectangles.length) {
            branch.lineAreas.push({
              lineIndex: lineIndex,
              left: localLineRectangles.reduce(function(value, rectangle) { return Math.min(value, rectangle.left); }, Infinity),
              right: localLineRectangles.reduce(function(value, rectangle) { return Math.max(value, rectangle.right); }, -Infinity),
              top: localLineRectangles.reduce(function(value, rectangle) { return Math.min(value, rectangle.top); }, Infinity),
              bottom: localLineRectangles.reduce(function(value, rectangle) { return Math.max(value, rectangle.bottom); }, -Infinity)
            });
          }

          var sideToggle = 'left';
          (childLinesByParentLine[lineIndex] || []).forEach(function(childLineIndex) {
            var child = buildBranchLayout(childLineIndex);
            if (!isFinite(child.left) || !child.rectangles.length) return;
            var meta = chainMetaByIndex[childLineIndex] || {};
            var originPosition = branch.nodes[String(meta.originNodeId)];
            var attachmentY = originPosition ? originPosition.y + verticalSpacing : 0;
            var placement = nearestFreeBranchX(
              child,
              branch,
              attachmentY,
              sideToggle,
              originPosition ? originPosition.x : 0
            );
            translateBranch(child, placement.x, placement.y);
            absorbBranch(branch, child);
            sideToggle = sideToggle === 'left' ? 'right' : 'left';
          });

          buildingLines.delete(lineIndex);
          completedLayouts[lineIndex] = branch;
          return branch;
        }

        var packedRoot = maleLineChains.length ? buildBranchLayout(0) : createEmptyBranch(0);
        var topSideToggle = 'left';
        // Some independent carrier lines have a deliberate historical anchor
        // inside the packed tree rather than the default top-row attachment.
        // The complete branch is translated at this stage, so its descendants
        // and wives retain their relative positions.
        var fixedTopLevelPlacementByStartId = {
          '4002037': {
            yAnchorId: '4002022', // Octávia Menor
            xAnchorId: '529691', // Julius Caesar
            xOffset: 520
          }
        };
        var topLevelLineOrder = topLevelLineIndices.slice();
        var octaviaLineIndex = nodeChainIndex['4002022'];
        if (topLevelLineOrder.indexOf(octaviaLineIndex) !== -1) {
          topLevelLineOrder.sort(function(left, right) {
            if (left === octaviaLineIndex) return -1;
            if (right === octaviaLineIndex) return 1;
            return left - right;
          });
        }
        topLevelLineOrder.forEach(function(lineIndex) {
          var branch = buildBranchLayout(lineIndex);
          if (!isFinite(branch.left) || !branch.rectangles.length) return;
          var lineStartId = maleLineChains[lineIndex] && maleLineChains[lineIndex].length
            ? String(maleLineChains[lineIndex][0])
            : null;
          var fixedPlacement = lineStartId ? fixedTopLevelPlacementByStartId[lineStartId] : null;
          var fixedYAnchor = fixedPlacement ? packedRoot.nodes[fixedPlacement.yAnchorId] : null;
          var fixedXAnchor = fixedPlacement ? packedRoot.nodes[fixedPlacement.xAnchorId] : null;
          var attachmentY = fixedYAnchor ? fixedYAnchor.y : 0;
          var preferredX = fixedXAnchor ? fixedXAnchor.x + fixedPlacement.xOffset : 0;
          var placement = nearestFreeBranchX(
            branch,
            packedRoot,
            attachmentY,
            topSideToggle,
            preferredX
          );
          if (fixedXAnchor) {
            placement.x = fixedXAnchor.x + fixedPlacement.xOffset - branch.anchorX;
          }
          translateBranch(branch, placement.x, placement.y);
          absorbBranch(packedRoot, branch);
          topSideToggle = topSideToggle === 'left' ? 'right' : 'left';
        });

        Object.keys(packedRoot.nodes).forEach(function(nodeId) {
          var position = packedRoot.nodes[nodeId];
          corePositionById[nodeId] = { x: position.x, y: position.y };
          if (coreNodeById[nodeId]) {
            coreNodeById[nodeId].x = position.x;
            coreNodeById[nodeId].y = position.y;
            coreNodeById[nodeId].physics = false;
          }
        });

        // Once every carrier has its final x coordinate, order each man's
        // wife slots by the centroid of that wife's visible children. The
        // leftmost wife therefore corresponds to the leftmost child group.
        Object.keys(wifeGroupsForLayout).forEach(function(husbandId) {
          var husbandPosition = packedRoot.nodes[String(husbandId)];
          if (!husbandPosition) return;
          var wives = wifeGroupsForLayout[husbandId].filter(function(item) {
            return !!packedRoot.bridges[String(item.nodeId)];
          }).slice();
          if (wives.length < 2) return;
          wives.sort(function(left, right) {
            function childCentroid(item) {
              var children = (biologicalChildrenByMother[String(item.nodeId)] || []).filter(function(childId) {
                return !!packedRoot.nodes[String(childId)];
              });
              if (!children.length) return Infinity;
              return children.reduce(function(sum, childId) {
                return sum + packedRoot.nodes[String(childId)].x;
              }, 0) / children.length;
            }
            var leftCentroid = childCentroid(left);
            var rightCentroid = childCentroid(right);
            if (leftCentroid !== rightCentroid) return leftCentroid - rightCentroid;
            return compareNodeIds(left.nodeId, right.nodeId);
          });
          var reorderedBlock = computeWifeBlock(husbandPosition.x + wifeXOffset, wives);
          reorderedBlock.positions.forEach(function(item) {
            var wifePosition = packedRoot.bridges[String(item.motherId)];
            if (wifePosition) wifePosition.x = item.x;
          });
        });

        Object.keys(packedRoot.bridges).forEach(function(nodeId) {
          var position = packedRoot.bridges[nodeId];
          bridgePositionById[nodeId] = { x: position.x, y: position.y };
          if (siblingHusbandByWife[nodeId]) {
            corePositionById[nodeId] = { x: position.x, y: position.y };
          }
          subNodes.forEach(function(node) {
            if (String(node.id) !== nodeId) return;
            node.x = position.x;
            node.y = position.y;
            node.estimated_width = position.width;
            node.physics = false;
          });
        });

        // Do not place daughters whose father is outside the selected house
        // yet. Their external father is positioned below; placing them here
        // would stack every such daughter at the same fallback coordinate.
        Array.from(leafDaughterCoreIds).forEach(function(nodeId) {
          nodeId = String(nodeId);
          if (corePositionById[nodeId]) return;
        });
        // A bridge can be absent from a line's local wife list when the
        // selected carrier relationship is maternal or its children live in a
        // different extracted line.  Resolve these after every carrier has a
        // final coordinate; never send them all to the fixed top-right slot.
        var fallbackWifeCountByHusband = {};
        subNodes.forEach(function(node) {
          var nodeId = String(node.id);
          if (!node.maternal_bridge || bridgePositionById[nodeId]) return;
          var husbandId = selectLikelyHusbandId(nodeId, coreChildrenByMother[nodeId] || []);
          var husbandPosition = husbandId != null ? corePositionById[String(husbandId)] : null;
          if (husbandPosition) {
            var husbandKey = String(husbandId);
            var wifeIndex = fallbackWifeCountByHusband[husbandKey] || 0;
            node.x = husbandPosition.x + wifeXOffset + wifeIndex * (estimateNodeFootprint(nodeId) + 24);
            node.y = husbandPosition.y;
            fallbackWifeCountByHusband[husbandKey] = wifeIndex + 1;
          } else {
            // Truly unconnected bridges have no meaningful family anchor.
            node.x = wifeXOffset;
            node.y = 0;
          }
          node.physics = false;
          bridgePositionById[nodeId] = { x: node.x, y: node.y };
        });
      } else {
      var coreX = {};
      var chainColumnX = new Array(maleLineChains.length);
      var chainWidths = maleLineChains.map(function(chain) {
        return chain.reduce(function(maxWidth, nodeId) {
          return Math.max(maxWidth, estimateNodeFootprint(String(nodeId)));
        }, horizontalSpacing);
      });

      var chainLeftExtent = maleLineChains.map(function(_chain, chainIndex) {
        return chainWidths[chainIndex] / 2;
      });
      var chainRightExtent = maleLineChains.map(function(_chain, chainIndex) {
        return chainWidths[chainIndex] / 2;
      });

      Object.keys(daughterGroupsByFather).forEach(function(fatherId) {
        fatherId = String(fatherId);
        var chainIndex = nodeChainIndex[fatherId];
        if (chainIndex == null) return;
        var daughterIds = daughterGroupsByFather[fatherId].slice().sort(compareNodeIds);
        if (!daughterIds.length) return;
        var daughterBlock = computeDaughterBlock(0, daughterIds);
        if (isFinite(daughterBlock.left)) {
          chainLeftExtent[chainIndex] = Math.max(chainLeftExtent[chainIndex], -daughterBlock.left + 16);
        }
      });

      var estimatedWivesByHusband = {};
      subNodes.forEach(function(node) {
        if (!node.maternal_bridge) return;
        var motherId = String(node.id);
        var visibleChildren = (coreChildrenByMother[motherId] || []).slice();
        var husbandId = selectLikelyHusbandId(motherId, visibleChildren);
        if (!husbandId || nodeChainIndex[String(husbandId)] == null) return;
        var husbandKey = String(husbandId);
        if (!estimatedWivesByHusband[husbandKey]) estimatedWivesByHusband[husbandKey] = [];
        estimatedWivesByHusband[husbandKey].push({
          motherId: motherId,
          width: estimateNodeFootprint(motherId)
        });
      });

      Object.keys(estimatedWivesByHusband).forEach(function(husbandId) {
        husbandId = String(husbandId);
        var chainIndex = nodeChainIndex[husbandId];
        if (chainIndex == null) return;
        var wifeBlock = computeWifeBlock(
          wifeXOffset,
          estimatedWivesByHusband[husbandId].slice().sort(function(a, b) {
            return compareNodeIds(a.motherId, b.motherId);
          })
        );
        if (isFinite(wifeBlock.right)) {
          chainRightExtent[chainIndex] = Math.max(chainRightExtent[chainIndex], wifeBlock.right + 16);
        }
      });

      function sortChainIndicesByOrigin(indices) {
        return indices.slice().sort(function(a, b) {
          var metaA = chainMetaByIndex[a] || {};
          var metaB = chainMetaByIndex[b] || {};
          var depthA = metaA.startId != null && depthById[String(metaA.startId)] != null ? depthById[String(metaA.startId)] : Infinity;
          var depthB = metaB.startId != null && depthById[String(metaB.startId)] != null ? depthById[String(metaB.startId)] : Infinity;
          if (depthA !== depthB) return depthA - depthB;
          if (metaA.startId != null && metaB.startId != null) {
            return compareNodeIds(metaA.startId, metaB.startId);
          }
          return a - b;
        });
      }

      var childChainsByOrigin = {};
      var topLevelChainIndices = [];
      chainMetaByIndex.forEach(function(meta) {
        if (!meta || meta.chainIndex === 0) return;
        if (meta.originChainIndex != null) {
          if (!childChainsByOrigin[meta.originChainIndex]) childChainsByOrigin[meta.originChainIndex] = [];
          childChainsByOrigin[meta.originChainIndex].push(meta.chainIndex);
        } else {
          topLevelChainIndices.push(meta.chainIndex);
        }
      });

      var chainSideByIndex = {};
      if (maleLineChains.length > 0) {
        chainSideByIndex[0] = 'center';
      }

      var rootSideToggle = 1;
      function assignChainSides(chainIndex) {
        sortChainIndicesByOrigin(childChainsByOrigin[chainIndex] || []).forEach(function(childChainIndex) {
          if (chainSideByIndex[childChainIndex]) {
            assignChainSides(childChainIndex);
            return;
          }
          if (chainIndex === 0) {
            chainSideByIndex[childChainIndex] = rootSideToggle > 0 ? 'right' : 'left';
            rootSideToggle *= -1;
          } else {
            chainSideByIndex[childChainIndex] = chainSideByIndex[chainIndex] === 'left' ? 'left' : 'right';
          }
          assignChainSides(childChainIndex);
        });
      }

      if (maleLineChains.length > 0) {
        assignChainSides(0);
        sortChainIndicesByOrigin(topLevelChainIndices).forEach(function(chainIndex) {
          if (!chainSideByIndex[chainIndex]) {
            chainSideByIndex[chainIndex] = rootSideToggle > 0 ? 'right' : 'left';
            rootSideToggle *= -1;
          }
          assignChainSides(chainIndex);
        });
      }

      function collectSidePlacementOrder(chainIndex, side, out, visited) {
        sortChainIndicesByOrigin(childChainsByOrigin[chainIndex] || []).forEach(function(childChainIndex) {
          if (chainSideByIndex[childChainIndex] !== side) return;
          if (visited.has(childChainIndex)) return;
          visited.add(childChainIndex);
          out.push(childChainIndex);
          collectSidePlacementOrder(childChainIndex, side, out, visited);
        });
      }

      if (maleLineChains.length > 0) {
        chainColumnX[0] = 0;
        var rightPlacementOrder = [];
        var leftPlacementOrder = [];
        var rightVisited = new Set();
        var leftVisited = new Set();

        collectSidePlacementOrder(0, 'right', rightPlacementOrder, rightVisited);
        collectSidePlacementOrder(0, 'left', leftPlacementOrder, leftVisited);

        sortChainIndicesByOrigin(topLevelChainIndices).forEach(function(chainIndex) {
          var side = chainSideByIndex[chainIndex];
          if (side === 'right' && !rightVisited.has(chainIndex)) {
            rightVisited.add(chainIndex);
            rightPlacementOrder.push(chainIndex);
            collectSidePlacementOrder(chainIndex, 'right', rightPlacementOrder, rightVisited);
          } else if (side === 'left' && !leftVisited.has(chainIndex)) {
            leftVisited.add(chainIndex);
            leftPlacementOrder.push(chainIndex);
            collectSidePlacementOrder(chainIndex, 'left', leftPlacementOrder, leftVisited);
          }
        });

        var rightEdge = chainRightExtent[0];
        rightPlacementOrder.forEach(function(chainIndex) {
          chainColumnX[chainIndex] = rightEdge + chainColumnGap + chainLeftExtent[chainIndex];
          rightEdge = chainColumnX[chainIndex] + chainRightExtent[chainIndex];
        });

        var leftEdge = -chainLeftExtent[0];
        leftPlacementOrder.forEach(function(chainIndex) {
          chainColumnX[chainIndex] = leftEdge - chainColumnGap - chainRightExtent[chainIndex];
          leftEdge = chainColumnX[chainIndex] - chainLeftExtent[chainIndex];
        });
      }

      maleLineChains.forEach(function(chain, chainIndex) {
        var chainX = chainColumnX[chainIndex];
        chain.forEach(function(nodeId) {
          coreX[String(nodeId)] = chainX;
        });
      });

      var overflowCursor = maleLineChains.length > 0
        ? maleLineChains.reduce(function(acc, _chain, chainIndex) {
            return Math.max(acc, chainColumnX[chainIndex] + chainRightExtent[chainIndex]);
          }, chainColumnX[0] + chainRightExtent[0]) + horizontalSpacing
        : horizontalSpacing;
      Array.from(coreIds).forEach(function(nodeId) {
        nodeId = String(nodeId);
        if (leafDaughterCoreIds.has(nodeId)) return;
        if (typeof coreX[nodeId] === 'number') return;
        coreX[nodeId] = overflowCursor;
        overflowCursor += horizontalSpacing;
      });

      function enforceRowSpacing(depth, anchorsByNodeId) {
        var row = (coreLayers[depth] || []).map(function(nodeId) {
          return String(nodeId);
        }).filter(function(nodeId) {
          return typeof coreX[nodeId] === 'number';
        });
        if (row.length <= 1) return;

        row.sort(function(a, b) {
          var diff = (coreX[String(a)] || 0) - (coreX[String(b)] || 0);
          if (diff !== 0) return diff;
          return compareNodeIds(a, b);
        });

        var ideals = row.map(function(nodeId) { return coreX[String(nodeId)] || 0; });
        var centroid = ideals.reduce(function(sum, value) { return sum + value; }, 0) / ideals.length;
        var gaps = [];
        for (var gapIndex = 0; gapIndex < row.length - 1; gapIndex += 1) {
          gaps.push(minimumGapBetween(row[gapIndex], row[gapIndex + 1]));
        }

        var minSpan = gaps.reduce(function(sum, value) { return sum + value; }, 0);
        var currentSpan = Math.max(1, ideals[ideals.length - 1] - ideals[0]);
        var compressionFactor = 1;
        if (currentSpan > minSpan * 1.15) {
          compressionFactor = Math.max(0.35, (minSpan * 1.05) / currentSpan);
        } else if (currentSpan < minSpan) {
          compressionFactor = minSpan / currentSpan;
        }

        var solved = ideals.map(function(value) {
          return centroid + (value - centroid) * compressionFactor;
        });

        var anchors = row.reduce(function(acc, nodeId, index) {
          if (anchorsByNodeId && typeof anchorsByNodeId[nodeId] === 'number') {
            acc.push({ index: index, x: anchorsByNodeId[nodeId] });
          }
          return acc;
        }, []);

        function solveWithoutAnchors() {
          for (var forward = 1; forward < solved.length; forward += 1) {
            solved[forward] = Math.max(solved[forward], solved[forward - 1] + gaps[forward - 1]);
          }
          for (var backward = solved.length - 2; backward >= 0; backward -= 1) {
            solved[backward] = Math.min(solved[backward], solved[backward + 1] - gaps[backward]);
          }

          var solvedCentroid = solved.reduce(function(sum, value) { return sum + value; }, 0) / solved.length;
          var shift = centroid - solvedCentroid;
          solved = solved.map(function(value) { return value + shift; });

          for (var forwardAgain = 1; forwardAgain < solved.length; forwardAgain += 1) {
            solved[forwardAgain] = Math.max(solved[forwardAgain], solved[forwardAgain - 1] + gaps[forwardAgain - 1]);
          }
          for (var backwardAgain = solved.length - 2; backwardAgain >= 0; backwardAgain -= 1) {
            solved[backwardAgain] = Math.min(solved[backwardAgain], solved[backwardAgain + 1] - gaps[backwardAgain]);
          }
        }

        if (!anchors.length) {
          solveWithoutAnchors();
        } else {
          var anchorsConflict = false;
          for (var anchorPair = 1; anchorPair < anchors.length; anchorPair += 1) {
            var requiredSpan = 0;
            for (var requiredIndex = anchors[anchorPair - 1].index; requiredIndex < anchors[anchorPair].index; requiredIndex += 1) {
              requiredSpan += gaps[requiredIndex];
            }
            if (anchors[anchorPair].x - anchors[anchorPair - 1].x < requiredSpan) {
              anchorsConflict = true;
              break;
            }
          }

          if (anchorsConflict) {
            solveWithoutAnchors();
          } else {
            anchors.forEach(function(anchor) {
              solved[anchor.index] = anchor.x;
            });

            var firstAnchor = anchors[0];
            for (var left = firstAnchor.index - 1; left >= 0; left -= 1) {
              solved[left] = Math.min(solved[left], solved[left + 1] - gaps[left]);
            }

            for (var segment = 1; segment < anchors.length; segment += 1) {
              var prevAnchor = anchors[segment - 1];
              var nextAnchor = anchors[segment];
              for (var betweenForward = prevAnchor.index + 1; betweenForward < nextAnchor.index; betweenForward += 1) {
                solved[betweenForward] = Math.max(solved[betweenForward], solved[betweenForward - 1] + gaps[betweenForward - 1]);
              }
              for (var betweenBackward = nextAnchor.index - 1; betweenBackward > prevAnchor.index; betweenBackward -= 1) {
                solved[betweenBackward] = Math.min(solved[betweenBackward], solved[betweenBackward + 1] - gaps[betweenBackward]);
              }
              for (var betweenForwardAgain = prevAnchor.index + 1; betweenForwardAgain < nextAnchor.index; betweenForwardAgain += 1) {
                solved[betweenForwardAgain] = Math.max(solved[betweenForwardAgain], solved[betweenForwardAgain - 1] + gaps[betweenForwardAgain - 1]);
              }
            }

            var lastAnchor = anchors[anchors.length - 1];
            for (var right = lastAnchor.index + 1; right < solved.length; right += 1) {
              solved[right] = Math.max(solved[right], solved[right - 1] + gaps[right - 1]);
            }
          }
        }

        row.forEach(function(nodeId, index) {
          coreX[String(nodeId)] = solved[index];
        });
      }

      for (var spacingDepth = 0; spacingDepth <= maxDepth; spacingDepth += 1) {
        var rowAnchors = {};
        (coreLayers[spacingDepth] || []).forEach(function(nodeId) {
          nodeId = String(nodeId);
          if (nodeChainIndex[nodeId] == null || typeof coreX[nodeId] !== 'number') return;
          rowAnchors[nodeId] = coreX[nodeId];
        });
        enforceRowSpacing(spacingDepth, rowAnchors);
      }

      Array.from(coreIds).forEach(function(nodeId) {
        nodeId = String(nodeId);
        if (leafDaughterCoreIds.has(nodeId)) return;
        var depth = depthById[nodeId] || 0;
        var x = coreX[nodeId] || 0;
        var y = depth * verticalSpacing;
        corePositionById[nodeId] = { x: x, y: y };
        if (coreNodeById[nodeId]) {
          coreNodeById[nodeId].x = x;
          coreNodeById[nodeId].y = y;
          coreNodeById[nodeId].physics = false;
        }
      });

      var occupiedXsByRow = {};
      function reserveOccupiedPosition(x, y, width) {
        var key = String(Math.round(y));
        if (!occupiedXsByRow[key]) occupiedXsByRow[key] = [];
        occupiedXsByRow[key].push({
          x: x,
          width: width
        });
      }

      function findNearestFreeX(desiredX, y, width, preferredDirection) {
        var row = occupiedXsByRow[String(Math.round(y))] || [];
        function isFree(candidateX) {
          for (var i = 0; i < row.length; i += 1) {
            var occupied = row[i];
            var requiredGap = (occupied.width + width) / 2 + 16;
            if (Math.abs(occupied.x - candidateX) < requiredGap) return false;
          }
          return true;
        }
        if (isFree(desiredX)) return desiredX;
        var sign = preferredDirection === 'left' ? -1 : 1;
        for (var step = 1; step <= 8; step += 1) {
          var primary = desiredX + sign * step * horizontalSpacing * 0.65;
          if (isFree(primary)) return primary;
          var alternate = desiredX - sign * step * horizontalSpacing * 0.65;
          if (isFree(alternate)) return alternate;
        }
        return desiredX;
      }

      // ─── Daughter placement by father block ──────────────────────────────────────
      var maleOccupancyByRow = {};
      Object.keys(corePositionById).forEach(function(nodeId) {
        nodeId = String(nodeId);
        if (leafDaughterCoreIds.has(nodeId)) return;
        var pos = corePositionById[nodeId];
        if (!pos) return;
        var width = estimateNodeFootprint(nodeId);
        var rowKey = String(Math.round(pos.y));
        if (!maleOccupancyByRow[rowKey]) maleOccupancyByRow[rowKey] = [];
        maleOccupancyByRow[rowKey].push({
          chainIdx: nodeChainIndex[nodeId],
          x: pos.x,
          left: pos.x - width / 2,
          right: pos.x + width / 2
        });
      });

      Object.keys(daughterGroupsByFather).forEach(function(fatherId) {
        fatherId = String(fatherId);
        if (!corePositionById[fatherId]) delete daughterGroupsByFather[fatherId];
      });

      var daughtersPlacedByFather = {};
      var placedDaughterBlocksByRow = {};

      function shiftChainsAtOrRightOf(minX, delta) {
        var affectedChains = new Set();
        maleLineChains.forEach(function(chain, chainIndex) {
          if (chainColumnX[chainIndex] < minX - 1) return;
          affectedChains.add(chainIndex);
          chainColumnX[chainIndex] += delta;
          chain.forEach(function(nodeId) {
            nodeId = String(nodeId);
            coreX[nodeId] = chainColumnX[chainIndex];
            if (corePositionById[nodeId]) corePositionById[nodeId].x = chainColumnX[chainIndex];
            if (coreNodeById[nodeId]) coreNodeById[nodeId].x = chainColumnX[chainIndex];
          });
        });

        Object.keys(maleOccupancyByRow).forEach(function(rowKey) {
          (maleOccupancyByRow[rowKey] || []).forEach(function(item) {
            if (!affectedChains.has(item.chainIdx)) return;
            item.x += delta;
            item.left += delta;
            item.right += delta;
          });
        });

        Object.keys(placedDaughterBlocksByRow).forEach(function(rowKey) {
          (placedDaughterBlocksByRow[rowKey] || []).forEach(function(block) {
            if (!affectedChains.has(block.chainIdx)) return;
            block.left += delta;
            block.right += delta;
          });
        });

        Array.from(leafDaughterCoreIds).forEach(function(nodeId) {
          nodeId = String(nodeId);
          var fatherId = fatherInCoreByChild[nodeId];
          if (!fatherId || !affectedChains.has(nodeChainIndex[String(fatherId)])) return;
          if (corePositionById[nodeId]) corePositionById[nodeId].x += delta;
          if (coreNodeById[nodeId] && corePositionById[nodeId]) coreNodeById[nodeId].x = corePositionById[nodeId].x;
        });

        Object.keys(daughtersPlacedByFather).forEach(function(fatherId) {
          if (!affectedChains.has(nodeChainIndex[String(fatherId)])) return;
          daughtersPlacedByFather[fatherId].lastX += delta;
        });
      }

      var daughterGroups = Object.keys(daughterGroupsByFather).map(function(fatherId) {
        fatherId = String(fatherId);
        return {
          fatherId: fatherId,
          chainIdx: nodeChainIndex[fatherId] == null ? 0 : nodeChainIndex[fatherId],
          y: (depthById[fatherId] + 1) * verticalSpacing,
          x: corePositionById[fatherId].x,
          daughterIds: daughterGroupsByFather[fatherId]
        };
      }).sort(function(a, b) {
        if (a.y !== b.y) return a.y - b.y;
        if (a.x !== b.x) return a.x - b.x;
        return compareNodeIds(a.fatherId, b.fatherId);
      });

      daughterGroups.forEach(function(group) {
        var fatherId = group.fatherId;
        var rowKey = String(Math.round(group.y));
        if (!placedDaughterBlocksByRow[rowKey]) placedDaughterBlocksByRow[rowKey] = [];

        while (true) {
          var fatherPos = corePositionById[fatherId];
          var fatherChainX = chainColumnX[group.chainIdx];
          var block = computeDaughterBlock(fatherPos.x, group.daughterIds);
          var requiredShift = 0;

          (maleOccupancyByRow[rowKey] || []).forEach(function(item) {
            if (item.x >= fatherChainX - 1) return;
            if (block.right <= item.left - 16 || block.left >= item.right + 16) return;
            requiredShift = Math.max(requiredShift, item.right + 16 - block.left);
          });

          (placedDaughterBlocksByRow[rowKey] || []).forEach(function(item) {
            if (block.right <= item.left - 16 || block.left >= item.right + 16) return;
            requiredShift = Math.max(requiredShift, item.right + 16 - block.left);
          });

          if (requiredShift <= 0) {
            daughtersPlacedByFather[fatherId] = {
              lastX: block.placements[block.placements.length - 1].x,
              lastWidth: block.placements[block.placements.length - 1].width
            };
            block.placements.forEach(function(item) {
              corePositionById[item.nodeId] = { x: item.x, y: group.y };
              if (coreNodeById[item.nodeId]) {
                coreNodeById[item.nodeId].x = item.x;
                coreNodeById[item.nodeId].y = group.y;
                coreNodeById[item.nodeId].physics = false;
              }
            });
            placedDaughterBlocksByRow[rowKey].push({
              fatherId: fatherId,
              chainIdx: group.chainIdx,
              left: block.left,
              right: block.right
            });
            break;
          }

          shiftChainsAtOrRightOf(fatherChainX, requiredShift);
          group.x = corePositionById[fatherId].x;
        }
      });

      Array.from(leafDaughterCoreIds).forEach(function(nodeId) {
        nodeId = String(nodeId);
        if (corePositionById[nodeId]) return;
        corePositionById[nodeId] = { x: 0, y: 0 };
        if (coreNodeById[nodeId]) {
          coreNodeById[nodeId].x = 0;
          coreNodeById[nodeId].y = 0;
          coreNodeById[nodeId].physics = false;
        }
      });
      // ─── End daughter placement ──────────────────────────────────────────────────

      // ─── Chain column merging: collapse non-Y-overlapping chains ─────────────────
      var MERGE_Y_GAP = verticalSpacing * 0.4;

      function chainYExtent(chainIndex) {
        var chain = maleLineChains[chainIndex];
        var minY = Infinity;
        var maxY = -Infinity;
        chain.forEach(function(nid) {
          nid = String(nid);
          var pos = corePositionById[nid];
          if (!pos) return;
          minY = Math.min(minY, pos.y);
          maxY = Math.max(maxY, pos.y);
        });
        Array.from(leafDaughterCoreIds).forEach(function(did) {
          did = String(did);
          var fid = fatherInCoreByChild[did];
          if (!fid || nodeChainIndex[String(fid)] !== chainIndex) return;
          var pos = corePositionById[did];
          if (!pos) return;
          minY = Math.min(minY, pos.y);
          maxY = Math.max(maxY, pos.y);
        });
        subNodes.forEach(function(node) {
          if (!node.maternal_bridge) return;
          var mid = String(node.id);
          var hid = selectLikelyHusbandId(mid, coreChildrenByMother[mid] || []);
          if (hid) hid = String(hid);
          if (hid && nodeChainIndex[String(hid)] !== chainIndex) hid = null;
          if (!hid) return;
          var husbandPos = corePositionById[hid];
          if (!husbandPos) return;
          minY = Math.min(minY, husbandPos.y);
          maxY = Math.max(maxY, husbandPos.y);
        });
        if (!isFinite(minY)) return null;
        return { min: minY, max: maxY };
      }

      function yExtentsOverlap(extA, extB) {
        if (!extA || !extB) return true;
        return extA.max + MERGE_Y_GAP >= extB.min && extB.max + MERGE_Y_GAP >= extA.min;
      }

      var chainExtents = maleLineChains.map(function(_chain, chainIndex) {
        return chainYExtent(chainIndex);
      });

      function effectiveChainSide(chainIndex) {
        if (chainSideByIndex[chainIndex] && chainSideByIndex[chainIndex] !== 'center') {
          return chainSideByIndex[chainIndex];
        }
        var x = chainColumnX[chainIndex];
        if (x < -0.5) return 'left';
        if (x > 0.5) return 'right';
        return 'center';
      }

      var chainMergedInto = {};
      if (maleLineChains.length > 0) {
        chainMergedInto[0] = 0;
      }

      for (var ci = 1; ci < maleLineChains.length; ci += 1) {
        var extI = chainExtents[ci];
        var merged = false;
        for (var cj = 0; cj < ci; cj += 1) {
          var rep = cj;
          while (chainMergedInto[rep] !== rep) rep = chainMergedInto[rep];
          var sharingRep = [];
          for (var ck = 0; ck <= ci - 1; ck += 1) {
            var r = ck;
            while (chainMergedInto[r] !== r) r = chainMergedInto[r];
            if (r === rep) sharingRep.push(ck);
          }
          var repSide = effectiveChainSide(rep);
          var currentSide = effectiveChainSide(ci);
          if (repSide !== currentSide) {
            continue;
          }
          var anyOverlap = sharingRep.some(function(sk) {
            if (effectiveChainSide(sk) !== currentSide) return true;
            return yExtentsOverlap(extI, chainExtents[sk]);
          });
          if (!anyOverlap) {
            chainMergedInto[ci] = rep;
            merged = true;
            break;
          }
        }
        if (!merged) {
          chainMergedInto[ci] = ci;
        }
      }

      for (var mi = 1; mi < maleLineChains.length; mi += 1) {
        var target = mi;
        while (chainMergedInto[target] !== target) target = chainMergedInto[target];
        if (target === mi) continue;
        var oldX = chainColumnX[mi];
        var newX = chainColumnX[target];
        var delta = newX - oldX;
        chainColumnX[mi] = newX;
        maleLineChains[mi].forEach(function(nid) {
          nid = String(nid);
          coreX[nid] = newX;
          if (corePositionById[nid]) corePositionById[nid].x = newX;
          if (coreNodeById[nid]) coreNodeById[nid].x = newX;
        });
        Array.from(leafDaughterCoreIds).forEach(function(did) {
          did = String(did);
          var fid = fatherInCoreByChild[did];
          if (!fid || nodeChainIndex[String(fid)] !== mi) return;
          if (corePositionById[did]) corePositionById[did].x += delta;
          if (coreNodeById[did] && corePositionById[did]) coreNodeById[did].x = corePositionById[did].x;
          if (daughtersPlacedByFather[String(fid)]) {
            daughtersPlacedByFather[String(fid)].lastX += delta;
          }
        });
      }
      // ─── End chain merging ────────────────────────────────────────────────────────

      Object.keys(corePositionById).forEach(function(nodeId) {
        reserveOccupiedPosition(corePositionById[nodeId].x, corePositionById[nodeId].y, estimateNodeFootprint(nodeId));
      });

      var wifeGroupsByHusband = {};
      var unanchoredWives = [];

      subNodes.forEach(function(node) {
        if (!node.maternal_bridge) return;
        var motherId = String(node.id);
        var wifeWidth = estimateNodeFootprint(motherId);
        var visibleChildren = (coreChildrenByMother[motherId] || []).filter(function(childId) {
          return !!corePositionById[String(childId)];
        });
        var husbandId = selectLikelyHusbandId(motherId, visibleChildren);

        var husbandPos = husbandId && corePositionById[String(husbandId)]
          ? corePositionById[String(husbandId)]
          : null;

        if (husbandPos) {
          var husbandKey = String(husbandId);
          if (!wifeGroupsByHusband[husbandKey]) {
            wifeGroupsByHusband[husbandKey] = {
              husbandId: husbandKey,
              x: husbandPos.x,
              y: husbandPos.y,
              wives: []
            };
          }
          wifeGroupsByHusband[husbandKey].wives.push({
            node: node,
            motherId: motherId,
            width: wifeWidth
          });
          return;
        }

        var targetX;
        var targetY;
        if (visibleChildren.length) {
          var childCentroid = visibleChildren.reduce(function(sum, childId) {
            return sum + corePositionById[String(childId)].x;
          }, 0) / visibleChildren.length;
          targetX = childCentroid + wifeXOffset * 0.5;
          targetY = (depthById[String(visibleChildren[0])] || 0) * verticalSpacing;
        } else {
          targetX = wifeXOffset;
          targetY = 0;
        }
        unanchoredWives.push({
          node: node,
          motherId: motherId,
          width: wifeWidth,
          targetX: targetX,
          targetY: targetY
        });
      });

      Object.keys(wifeGroupsByHusband).map(function(husbandId) {
        var group = wifeGroupsByHusband[husbandId];
        group.wives.sort(function(a, b) { return compareNodeIds(a.motherId, b.motherId); });
        return group;
      }).sort(function(a, b) {
        if (a.y !== b.y) return a.y - b.y;
        if (a.x !== b.x) return a.x - b.x;
        return compareNodeIds(a.husbandId, b.husbandId);
      }).forEach(function(group) {
        var startX = group.x + wifeXOffset;
        var rowKey = String(Math.round(group.y));
        var attempts = 0;
        while (attempts < 20) {
          var block = computeWifeBlock(startX, group.wives);
          var occupiedRow = occupiedXsByRow[rowKey] || [];
          var requiredShift = 0;
          occupiedRow.forEach(function(occ) {
            var occLeft = occ.x - occ.width / 2;
            var occRight = occ.x + occ.width / 2;
            if (block.right <= occLeft - 16 || block.left >= occRight + 16) return;
            requiredShift = Math.max(requiredShift, occRight + 16 - block.left);
          });
          if (requiredShift <= 0) {
            block.positions.forEach(function(item) {
              bridgePositionById[item.motherId] = { x: item.x, y: group.y };
              item.node.x = item.x;
              item.node.y = group.y;
              item.node.estimated_width = item.width;
              item.node.physics = false;
              reserveOccupiedPosition(item.x, group.y, item.width);
            });
            return;
          }
          startX += requiredShift;
          attempts += 1;
        }
      });

      unanchoredWives.forEach(function(item) {
        var targetX = item.targetX;
        var targetY = item.targetY;
        var occupiedRow = occupiedXsByRow[String(Math.round(targetY))] || [];
        var attempts = 0;
        while (attempts < 20) {
          var clear = occupiedRow.every(function(occ) {
            var required = (occ.width + item.width) / 2 + 16;
            return Math.abs(occ.x - targetX) >= required;
          });
          if (clear) break;
          targetX += item.width + 24;
          attempts += 1;
        }
        bridgePositionById[item.motherId] = { x: targetX, y: targetY };
        item.node.x = targetX;
        item.node.y = targetY;
        item.node.estimated_width = item.width;
        item.node.physics = false;
        reserveOccupiedPosition(targetX, targetY, item.width);
      });

      function shiftChainAttachments(chainIndex, delta) {
        if (!delta) return;
        chainColumnX[chainIndex] += delta;
        maleLineChains[chainIndex].forEach(function(nodeId) {
          nodeId = String(nodeId);
          coreX[nodeId] += delta;
          if (corePositionById[nodeId]) corePositionById[nodeId].x += delta;
          if (coreNodeById[nodeId]) coreNodeById[nodeId].x += delta;
        });

        Array.from(leafDaughterCoreIds).forEach(function(nodeId) {
          nodeId = String(nodeId);
          var fatherId = fatherInCoreByChild[nodeId];
          if (!fatherId || nodeChainIndex[String(fatherId)] !== chainIndex) return;
          if (corePositionById[nodeId]) corePositionById[nodeId].x += delta;
          if (coreNodeById[nodeId] && corePositionById[nodeId]) coreNodeById[nodeId].x = corePositionById[nodeId].x;
        });

        Object.keys(daughtersPlacedByFather).forEach(function(fatherId) {
          fatherId = String(fatherId);
          if (nodeChainIndex[fatherId] !== chainIndex) return;
          daughtersPlacedByFather[fatherId].lastX += delta;
        });

        Object.keys(placedDaughterBlocksByRow).forEach(function(rowKey) {
          (placedDaughterBlocksByRow[rowKey] || []).forEach(function(block) {
            if (block.chainIdx !== chainIndex) return;
            block.left += delta;
            block.right += delta;
          });
        });

        Object.keys(wifeGroupsByHusband).forEach(function(husbandId) {
          husbandId = String(husbandId);
          if (nodeChainIndex[husbandId] !== chainIndex) return;
          var group = wifeGroupsByHusband[husbandId];
          if (group) group.x += delta;
          (group && group.wives ? group.wives : []).forEach(function(item) {
            var motherId = String(item.motherId);
            if (bridgePositionById[motherId]) bridgePositionById[motherId].x += delta;
            if (item.node) item.node.x += delta;
          });
        });
      }

      function chainBoundsForIndices(chainIndices) {
        var chainSet = new Set(chainIndices.map(function(id) { return Number(id); }));
        var left = Infinity;
        var right = -Infinity;

        chainIndices.forEach(function(chainIndex) {
          (maleLineChains[chainIndex] || []).forEach(function(nodeId) {
            nodeId = String(nodeId);
            var pos = corePositionById[nodeId];
            if (!pos) return;
            var width = estimateNodeFootprint(nodeId);
            left = Math.min(left, pos.x - width / 2);
            right = Math.max(right, pos.x + width / 2);
          });
        });

        Array.from(leafDaughterCoreIds).forEach(function(nodeId) {
          nodeId = String(nodeId);
          var fatherId = fatherInCoreByChild[nodeId];
          if (!fatherId) return;
          if (!chainSet.has(Number(nodeChainIndex[String(fatherId)]))) return;
          var pos = corePositionById[nodeId];
          if (!pos) return;
          var width = estimateNodeFootprint(nodeId);
          left = Math.min(left, pos.x - width / 2);
          right = Math.max(right, pos.x + width / 2);
        });

        Object.keys(wifeGroupsByHusband).forEach(function(husbandId) {
          husbandId = String(husbandId);
          if (!chainSet.has(Number(nodeChainIndex[husbandId]))) return;
          var group = wifeGroupsByHusband[husbandId];
          (group && group.wives ? group.wives : []).forEach(function(item) {
            var motherId = String(item.motherId);
            var pos = bridgePositionById[motherId];
            if (!pos) return;
            var width = item.width || estimateNodeFootprint(motherId);
            left = Math.min(left, pos.x - width / 2);
            right = Math.max(right, pos.x + width / 2);
          });
        });

        if (!isFinite(left) || !isFinite(right)) return null;
        return { left: left, right: right };
      }

      function buildColumnGroups() {
        var sorted = maleLineChains.map(function(_chain, chainIndex) { return chainIndex; }).sort(function(a, b) {
          var diff = chainColumnX[a] - chainColumnX[b];
          if (Math.abs(diff) > 0.5) return diff;
          return a - b;
        });
        var groups = [];
        sorted.forEach(function(chainIndex) {
          if (!groups.length) {
            groups.push({ x: chainColumnX[chainIndex], chainIndices: [chainIndex] });
            return;
          }
          var last = groups[groups.length - 1];
          if (Math.abs(chainColumnX[chainIndex] - last.x) <= 0.5) {
            last.chainIndices.push(chainIndex);
            return;
          }
          groups.push({ x: chainColumnX[chainIndex], chainIndices: [chainIndex] });
        });
        return groups;
      }

      function shiftColumnGroupRange(groups, startIndex, endIndex, delta) {
        if (!delta) return;
        for (var gi = startIndex; gi <= endIndex; gi += 1) {
          groups[gi].x += delta;
          groups[gi].chainIndices.forEach(function(chainIndex) {
            shiftChainAttachments(chainIndex, delta);
          });
        }
      }

      function rebuildOccupiedRows() {
        occupiedXsByRow = {};
        Object.keys(corePositionById).forEach(function(nodeId) {
          reserveOccupiedPosition(corePositionById[nodeId].x, corePositionById[nodeId].y, estimateNodeFootprint(nodeId));
        });
        Object.keys(bridgePositionById).forEach(function(nodeId) {
          var pos = bridgePositionById[nodeId];
          if (!pos) return;
          reserveOccupiedPosition(pos.x, pos.y, estimateNodeFootprint(nodeId));
        });
      }

      var columnGroups = buildColumnGroups();
      if (columnGroups.length > 1) {
        var anchorGroupIndex = 0;
        var anchorAbsX = Infinity;
        columnGroups.forEach(function(group, index) {
          var absX = Math.abs(group.x);
          if (absX < anchorAbsX) {
            anchorAbsX = absX;
            anchorGroupIndex = index;
          }
        });

        var previousRightBounds = chainBoundsForIndices(columnGroups[anchorGroupIndex].chainIndices);
        for (var rightGroupIndex = anchorGroupIndex + 1; rightGroupIndex < columnGroups.length; rightGroupIndex += 1) {
          var currentRightBounds = chainBoundsForIndices(columnGroups[rightGroupIndex].chainIndices);
          if (!previousRightBounds || !currentRightBounds) {
            previousRightBounds = currentRightBounds;
            continue;
          }
          var rightGap = currentRightBounds.left - previousRightBounds.right;
          var rightSlack = rightGap - chainColumnGap;
          if (rightSlack > 1) {
            shiftColumnGroupRange(columnGroups, rightGroupIndex, columnGroups.length - 1, -rightSlack);
            currentRightBounds = chainBoundsForIndices(columnGroups[rightGroupIndex].chainIndices);
          }
          previousRightBounds = currentRightBounds;
        }

        var previousLeftBounds = chainBoundsForIndices(columnGroups[anchorGroupIndex].chainIndices);
        for (var leftGroupIndex = anchorGroupIndex - 1; leftGroupIndex >= 0; leftGroupIndex -= 1) {
          var currentLeftBounds = chainBoundsForIndices(columnGroups[leftGroupIndex].chainIndices);
          if (!previousLeftBounds || !currentLeftBounds) {
            previousLeftBounds = currentLeftBounds;
            continue;
          }
          var leftGap = previousLeftBounds.left - currentLeftBounds.right;
          var leftSlack = leftGap - chainColumnGap;
          if (leftSlack > 1) {
            shiftColumnGroupRange(columnGroups, 0, leftGroupIndex, leftSlack);
            currentLeftBounds = chainBoundsForIndices(columnGroups[leftGroupIndex].chainIndices);
          }
          previousLeftBounds = currentLeftBounds;
        }

        rebuildOccupiedRows();
      }

      }

      var subNodeById = {};
      subNodes.forEach(function(node) {
        subNodeById[String(node.id)] = node;
      });

      var expandedNodeById = {};
      subNodes.forEach(function(node) {
        if (node.expanded_branch) {
          expandedNodeById[String(node.id)] = node;
        }
      });

      function parentAncestorsOf(nodeId) {
        return (parentEdgesByChild[String(nodeId)] || [])
          .filter(function(edge) {
            var relation = edge.relation || '';
            return relation === 'father' || relation === 'mother' || relation === 'father_mother';
          })
          .sort(function(a, b) {
            var order = { father: 0, father_mother: 0, mother: 1 };
            var relCmp = (order[a.relation] || 0) - (order[b.relation] || 0);
            if (relCmp !== 0) return relCmp;
            return compareNodeIds(a.from, b.from);
          });
      }

      var positionedAncestorRoots = {};
      Object.keys(bridgePositionById).forEach(function(nodeId) {
        positionedAncestorRoots[String(nodeId)] = bridgePositionById[nodeId];
      });
      Object.keys(corePositionById).forEach(function(nodeId) {
        positionedAncestorRoots[String(nodeId)] = corePositionById[nodeId];
      });

      Object.keys(expandedBranchRoots).forEach(function(branchRootId) {
        branchRootId = String(branchRootId);
        var anchorPos = positionedAncestorRoots[branchRootId];
        var branchRootNode = subNodeById[branchRootId];
        if (!anchorPos || !branchRootNode || !branchRootNode.maternal_bridge) return;

        var horizontalStep = horizontalSpacing * 0.9;
        function ancestorVerticalStepForDepth(depth) {
          if (depth === 1) return verticalSpacing * 2;
          if (depth === 2) return verticalSpacing * 1;
          return verticalSpacing * 0.5;
        }
        var queue = [{ id: branchRootId, x: anchorPos.x, y: anchorPos.y, depth: 0, slot: 0 }];
        var head = 0;
        var placed = {};
        placed[branchRootId] = { x: anchorPos.x, y: anchorPos.y };

        while (head < queue.length) {
          var item = queue[head++];
          if (item.depth >= 3) continue;

          var parents = parentAncestorsOf(item.id);
          if (!parents.length) continue;

          parents.forEach(function(edge, index) {
            var parentId = String(edge.from);
            if (placed[parentId]) return;
            var nextDepth = item.depth + 1;
            var nextSlot = parents.length === 2 ? (item.slot * 2 + index) : item.slot * 2;
            var verticalStep = ancestorVerticalStepForDepth(nextDepth);
            var resolvedX = anchorPos.x + nextDepth * horizontalStep;
            var resolvedY = anchorPos.y + (nextSlot - (Math.pow(2, nextDepth) - 1) / 2) * verticalStep;
            placed[parentId] = { x: resolvedX, y: resolvedY };
            positionedAncestorRoots[parentId] = { x: resolvedX, y: resolvedY };

            var expandedNode = expandedNodeById[parentId];
            if (expandedNode) {
              expandedNode.x = resolvedX;
              expandedNode.y = resolvedY;
              expandedNode.physics = false;
            }

            queue.push({ id: parentId, x: resolvedX, y: resolvedY, depth: nextDepth, slot: nextSlot });
          });
        }
      });

      var externalParentAnchorCandidates = {};
      rootIds.forEach(function(rootId) {
        rootId = String(rootId);
        var rootPos = corePositionById[rootId];
        var parentPair = externalRootParentsByChild[rootId];
        if (!rootPos || !parentPair) return;
        function addExternalParentAnchor(parentId, horizontalOffset) {
          if (!parentId || !subNodeById[String(parentId)]) return;
          parentId = String(parentId);
          if (!externalParentAnchorCandidates[parentId]) {
            externalParentAnchorCandidates[parentId] = [];
          }
          externalParentAnchorCandidates[parentId].push({
            x: rootPos.x + horizontalOffset,
            y: rootPos.y - verticalSpacing
          });
        }
        addExternalParentAnchor(parentPair.father, -horizontalSpacing / 2);
        addExternalParentAnchor(parentPair.mother, horizontalSpacing / 2);
      });

      Object.keys(externalParentAnchorCandidates).forEach(function(parentId) {
        // A parent shared by many roots is anchored once above the topmost
        // child instead of being overwritten by traversal order.
        var anchor = externalParentAnchorCandidates[parentId].slice().sort(function(left, right) {
          if (left.y !== right.y) return left.y - right.y;
          return left.x - right.x;
        })[0];
        var parentNode = subNodeById[parentId];
        parentNode.x = anchor.x;
        parentNode.y = anchor.y;
        parentNode.physics = false;
      });

      // Some houses have one external parent connected to several independent
      // core roots. Anchor that parent from the visible children themselves,
      // not from a single root traversal order.
      var visibleChildrenByExternalParent = {};
      originalEdges.forEach(function(edge) {
        var parentId = String(edge.from);
        var childId = String(edge.to);
        var relation = edge.relation || edge.title || '';
        if (!externalRootParentIds.has(parentId) || !corePositionById[childId]) return;
        if (relation !== 'father' && relation !== 'mother' && relation !== 'father_mother') return;
        if (!visibleChildrenByExternalParent[parentId]) {
          visibleChildrenByExternalParent[parentId] = [];
        }
        visibleChildrenByExternalParent[parentId].push({
          position: corePositionById[childId],
          relation: relation
        });
      });
      Object.keys(visibleChildrenByExternalParent).forEach(function(parentId) {
        var parentNode = subNodeById[parentId];
        var children = visibleChildrenByExternalParent[parentId];
        if (!parentNode || !children.length) return;
        var childCenterX = children.reduce(function(sum, child) {
          return sum + child.position.x;
        }, 0) / children.length;
        var topChildY = children.reduce(function(top, child) {
          return Math.min(top, child.position.y);
        }, Infinity);
        var fatherCount = children.filter(function(child) { return child.relation === 'father'; }).length;
        var motherCount = children.filter(function(child) { return child.relation === 'mother'; }).length;
        var sideOffset = fatherCount >= motherCount ? -horizontalSpacing / 2 : horizontalSpacing / 2;
        parentNode.x = childCenterX + sideOffset;
        parentNode.y = topChildY - verticalSpacing;
        parentNode.physics = false;
      });

      // A dynasty can include women whose common father is outside the house.
      // The recursive layout has no core column for that father, so resolve
      // these daughters only after external-parent anchors are final.
      var deferredDaughtersByFather = {};
      var unanchoredDeferredDaughters = [];
      Array.from(leafDaughterCoreIds).forEach(function(nodeId) {
        nodeId = String(nodeId);
        if (corePositionById[nodeId]) return;
        var biologicalFatherId = biologicalFatherByChild[nodeId]
          ? String(biologicalFatherByChild[nodeId])
          : null;
        var externalFather = biologicalFatherId ? subNodeById[biologicalFatherId] : null;
        if (
          biologicalFatherId &&
          externalFather &&
          Number.isFinite(externalFather.x) &&
          Number.isFinite(externalFather.y)
        ) {
          if (!deferredDaughtersByFather[biologicalFatherId]) {
            deferredDaughtersByFather[biologicalFatherId] = [];
          }
          deferredDaughtersByFather[biologicalFatherId].push(nodeId);
        } else {
          unanchoredDeferredDaughters.push(nodeId);
        }
      });

      Object.keys(deferredDaughtersByFather).forEach(function(fatherId) {
        var fatherNode = subNodeById[fatherId];
        var daughterBlock = computeDaughterBlock(
          fatherNode.x,
          deferredDaughtersByFather[fatherId].slice().sort(compareNodeIds)
        );
        daughterBlock.placements.forEach(function(item) {
          var daughterY = fatherNode.y + verticalSpacing;
          corePositionById[item.nodeId] = { x: item.x, y: daughterY };
          if (coreNodeById[item.nodeId]) {
            coreNodeById[item.nodeId].x = item.x;
            coreNodeById[item.nodeId].y = daughterY;
            coreNodeById[item.nodeId].physics = false;
          }
        });
      });

      // A missing father anchor is unusual, but it must still never cause a
      // stack of nodes. Put each such daughter in a deterministic side row.
      unanchoredDeferredDaughters.sort(compareNodeIds).forEach(function(nodeId, index) {
        var fallbackX = -wifeXOffset - index * (estimateNodeFootprint(nodeId) + 24);
        var fallbackY = verticalSpacing;
        corePositionById[nodeId] = { x: fallbackX, y: fallbackY };
        if (coreNodeById[nodeId]) {
          coreNodeById[nodeId].x = fallbackX;
          coreNodeById[nodeId].y = fallbackY;
          coreNodeById[nodeId].physics = false;
        }
      });

      if (state.activePatrilineRootId != null && corePositionById[String(state.activePatrilineRootId)]) {
        var patrilineRootPos = corePositionById[String(state.activePatrilineRootId)];
        var descendantNodes = subNodes.filter(function(node) {
          return node.descendant_extension;
        }).sort(function(a, b) {
          return compareNodeIds(a.id, b.id);
        });
        if (descendantNodes.length) {
          var descendantSpacing = 220;
          var descendantStartX = patrilineRootPos.x - ((descendantNodes.length - 1) * descendantSpacing) / 2;
          descendantNodes.forEach(function(node, index) {
            node.x = descendantStartX + index * descendantSpacing;
            node.y = patrilineRootPos.y + verticalSpacing;
            node.physics = false;
          });
        }
      }

      var manualPositions = manualPositionsForCurrentContext();
      Object.keys(manualPositions).forEach(function(nodeId) {
        var pos = manualPositions[nodeId];
        if (!pos) return;
        if (corePositionById[nodeId]) {
          corePositionById[nodeId].x = pos.x;
          corePositionById[nodeId].y = pos.y;
        }
        if (bridgePositionById[nodeId]) {
          bridgePositionById[nodeId].x = pos.x;
          bridgePositionById[nodeId].y = pos.y;
        }
        if (subNodeById[nodeId]) {
          subNodeById[nodeId].x = pos.x;
          subNodeById[nodeId].y = pos.y;
          subNodeById[nodeId].physics = false;
        }
      });

      var visibleIds = new Set(subNodes.map(function(node) { return String(node.id); }));
      var subEdges = originalEdges.filter(function(edge) {
        var key = String(edge.from) + '->' + String(edge.to);
        return visibleIds.has(String(edge.from)) && visibleIds.has(String(edge.to)) && visibleEdgeKeys.has(key);
      }).map(function(edge) {
        var copy = Object.assign({}, edge);
        copy.smooth = false;
        if (expandedBranchIds.has(String(edge.from)) || expandedBranchIds.has(String(edge.to))) {
          copy.color = { color: '#4f46e5', highlight: '#4f46e5' };
          copy.width = 2.2;
          return copy;
        }
        if (bridgeIds.has(String(edge.from))) {
          copy.color = { color: '#000000', highlight: '#000000' };
          copy.width = 0.6;
          copy.dashes = [6, 8];
        } else if (copy.relation === 'father' || copy.relation === 'father_mother') {
          copy.color = { color: '#2f7a2f', highlight: '#1f5a1f' };
          copy.width = 1.2;
          copy.dashes = false;
        } else if (copy.relation === 'mother') {
          copy.color = { color: '#000000', highlight: '#000000' };
          copy.width = 0.6;
          copy.dashes = [6, 8];
        }
        return copy;
      });

      return { nodes: subNodes, edges: subEdges, deterministic: true };
    }

    function replaceData(nextNodes, nextEdges, fitView, deterministic) {
      suppressSelectionNavigation = true;
      hideOverviewEdgeTooltip();

      // vis-network can advance one physics tick while setData is installing a
      // dataset. Freeze deterministic coordinates before that handoff, while
      // keeping dynasty nodes draggable for manual layout adjustments.
      if (state.mode === 'overview' || deterministic) {
        nextNodes.forEach(function(node) {
          node.physics = false;
          node.fixed = state.mode === 'overview'
            ? { x: true, y: true }
            : { x: false, y: false };
        });
        network.setOptions({ physics: { enabled: false } });
      }
      nodes.clear();
      edges.clear();
      if (nextNodes.length) nodes.add(nextNodes);
      if (nextEdges.length) edges.add(nextEdges);
      network.setData({ nodes: nodes, edges: edges });
      if (typeof window.refreshEdgeHighlightBaseColors === 'function') {
        window.refreshEdgeHighlightBaseColors({ reset: false });
      }
      if (typeof network.unselectAll === 'function') {
        network.unselectAll();
      }
      updateOverviewBackground();
      hideLoadingOverlay();

      if (state.mode === 'overview' || deterministic) {
        if (state.mode === 'overview') {
          network.setOptions({
            interaction: { hover: true },
            physics: { enabled: false },
            edges: { smooth: false, hoverWidth: 0, selectionWidth: 0 }
          });
        } else {
          network.setOptions({
            interaction: { hover: true, dragNodes: true },
            physics: { enabled: false },
            edges: { smooth: false }
          });
        }
      } else {
        network.setOptions({
          interaction: { hover: true },
          physics: { enabled: true },
          edges: { smooth: { enabled: true, type: 'dynamic' } }
        });
      }

      if (fitView) {
        setTimeout(function() {
          if (state.mode === 'overview') {
            network.fit({ animation: true });
          } else if (deterministic) {
            network.fit({ animation: true });
          } else if (state.mode === 'dynasty') {
            network.fit({ animation: true, maxZoomLevel: 1.4 });
          }
        }, 30);
      }
      setTimeout(function() {
        suppressSelectionNavigation = false;
      }, 80);
    }

    function preventCollapsedDynastyLayout(dynastyGraph) {
      var visibleNodes = (dynastyGraph.nodes || []).filter(function(node) {
        return !node.maternal_bridge && !node.bridge_node;
      });
      if (visibleNodes.length < 2) return;

      var coordinateKeys = {};
      var invalidNodes = [];
      var minX = Infinity;
      var maxX = -Infinity;
      var maxY = -Infinity;
      visibleNodes.forEach(function(node) {
        var x = Number(node.x);
        var y = Number(node.y);
        if (!isFinite(x) || !isFinite(y)) {
          invalidNodes.push(node);
          return;
        }
        coordinateKeys[Math.round(x) + ':' + Math.round(y)] = true;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      });

      // A partially unresolved spouse/daughter must not cause the fallback to
      // replace an otherwise valid genealogy with an alphabetical grid. Keep
      // the computed lineage intact and give only unresolved nodes a stable
      // side row beneath it.
      if (Object.keys(coordinateKeys).length > 1) {
        if (invalidNodes.length) {
          var fallbackStartX = isFinite(minX) ? minX : 0;
          var fallbackY = isFinite(maxY) ? maxY + 190 : 0;
          invalidNodes.slice().sort(function(left, right) {
            return String(left.label || left.id).localeCompare(String(right.label || right.id));
          }).forEach(function(node, index) {
            node.x = fallbackStartX + index * 260;
            node.y = fallbackY;
            node.fixed = { x: true, y: true };
            node.physics = false;
          });
        }
        return;
      }

      // A malformed lazy payload must not leave every house member stacked at
      // one point. This fallback is used only when the normal layout collapsed.
      var columns = Math.ceil(Math.sqrt(visibleNodes.length));
      var spacingX = 260;
      var spacingY = 190;
      visibleNodes.slice().sort(function(left, right) {
        return String(left.label || left.id).localeCompare(String(right.label || right.id));
      }).forEach(function(node, index) {
        var column = index % columns;
        var row = Math.floor(index / columns);
        node.x = (column - (columns - 1) / 2) * spacingX;
        node.y = row * spacingY;
        node.fixed = { x: true, y: true };
        node.physics = false;
      });
    }

    function applyMode(fitView) {
      if (state.activeRegionMapNodeId == null) {
        closeRegionMapModal();
      }
      var dynastyId = normalizeSelectedDynasty();
      if (state.mode === 'dynasty' && state.activePatrilineRootId == null && dynastyId === 'all') {
        state.mode = 'overview';
        syncControls();
        applyMode(fitView);
        return;
      }
      if (
        state.mode === 'dynasty' &&
        (!fullGraphReady || (DYNASTY_DATA_URL && loadedDynastyId !== String(dynastyId)))
      ) {
        ensureDynastyGraph(dynastyId).then(function() {
          applyMode(fitView);
        }).catch(function(error) {
          var message = 'Could not load dynasty data: ' + error.message;
          updateStatus(message);
          showLazyDiagnostic('Lazy graph diagnostic\nERROR: ' + message, true);
        });
        return;
      }
      state.selectedDynastyId = dynastyId;
      state.dynastyLayoutMode = 'genealogical';

      if (state.mode === 'overview') {
        state.activePatrilineRootId = null;
        state.activeOverviewDynastyId = null;
        replaceData(buildOverviewNodes(), buildOverviewEdges(), fitView, true);
        updateStatus('Overview mode: click a house to show its links. Double click to open the house.');
        return;
      }

      if (state.mode === 'dynasty') {
        var dynastyGraph;
        try {
          dynastyGraph = buildDynastySubgraph(dynastyId);
        } catch (error) {
          var buildMessage = 'Could not build dynasty view: ' + error.message;
          updateStatus(buildMessage);
          showLazyDiagnostic('Lazy graph diagnostic\nERROR: ' + buildMessage + '\n' + (error.stack || ''), true);
          return;
        }
        preventCollapsedDynastyLayout(dynastyGraph);
        showLazyDiagnostic(
          'Lazy graph diagnostic\n3. Built dynasty ' + dynastyId +
          ' with ' + dynastyGraph.nodes.length + ' visible nodes and ' + dynastyGraph.edges.length + ' links.',
          false
        );
        replaceData(dynastyGraph.nodes, dynastyGraph.edges, fitView, true);
        hideLazyDiagnostic();
        if (state.activePatrilineRootId != null) {
          var rootNode = personNodeById[String(state.activePatrilineRootId)];
          updateStatus('Dynasty mode: patrilineal house of ' + (rootNode && rootNode.label ? rootNode.label : state.activePatrilineRootId));
        } else {
          updateStatus(
            'Dynasty mode: ' +
            (dynastyById[dynastyId] ? dynastyById[dynastyId].dynasty_name : dynastyId) +
            ' (' + dynastyGraph.nodes.length + ' visible nodes)'
          );
        }
        return;
      }

      state.mode = dynastyId === 'all' ? 'overview' : 'dynasty';
      syncControls();
      applyMode(fitView);
    }

    function bindEvents() {
      var backBtn = document.getElementById('graph-back-btn');
      var forwardBtn = document.getElementById('graph-forward-btn');

      backBtn.addEventListener('click', function() {
        if (!historyStack.length) {
          // The root of navigation is the atlas selector, not a particular map.
          state.mode = 'overview';
          state.activeOverviewDynastyId = null;
          state.activePatrilineRootId = null;
          state.selectedPersonId = null;
          showMapChooser();
          syncControls();
          return;
        }
        forwardHistoryStack.push(captureSnapshot());
        var snapshot = historyStack.pop();
        restoreSnapshot(snapshot);
        syncControls();
      });

      forwardBtn.addEventListener('click', function() {
        if (!forwardHistoryStack.length) return;
        historyStack.push(captureSnapshot());
        var snapshot = forwardHistoryStack.pop();
        restoreSnapshot(snapshot);
        syncControls();
      });

      network.on('selectNode', function(params) {
        if (suppressSelectionNavigation) return;
        if (state.mode === 'overview' && overviewTransitioning) return;
        var nodeId = params && params.nodes && params.nodes.length ? params.nodes[0] : null;
        if (nodeId == null) return;
        var node = nodes.get(nodeId);
        if (!node) return;

        if (state.mode === 'overview') {
          return;
        }

        if (String(node.id).indexOf('dynasty:') === 0 && node.dynasty_id != null) {
          pushHistory();
          state.activeRegionMapNodeId = null;
          state.selectedDynastyId = String(node.dynasty_id);
          state.activePatrilineRootId = null;
          state.mode = 'dynasty';
          state.selectedPersonId = null;
          setPersistedDynastyLayoutMode('genealogical');
          syncControls();
          applyMode(true);
          return;
        }

        if (state.mode === 'dynasty' && node.maternal_bridge) {
          return;
        }

        state.selectedPersonId = node.id;
        var selectedDynasties = nodeDynastyIds(node);
        if (selectedDynasties.length) {
          state.selectedDynastyId = String(selectedDynasties[0]);
        }
        syncControls();
      });

      network.on('doubleClick', function(params) {
        if (suppressSelectionNavigation) return;
        if (state.mode === 'overview' && overviewTransitioning) return;
        if (pendingOverviewClickTimer) {
          clearTimeout(pendingOverviewClickTimer);
          pendingOverviewClickTimer = null;
        }
        var nodeId = params && params.nodes && params.nodes.length ? params.nodes[0] : null;
        if (nodeId == null) return;
        var node = nodes.get(nodeId);
        if (!node) return;

        if (String(node.id).indexOf('dynasty:') === 0 && node.dynasty_id != null) {
          pushHistory();
          state.activeOverviewDynastyId = null;
          state.selectedDynastyId = String(node.dynasty_id);
          state.activePatrilineRootId = null;
          state.selectedPersonId = null;
          state.mode = 'dynasty';
          setPersistedDynastyLayoutMode('genealogical');
          syncControls();
          applyMode(true);
          return;
        }

        return;
      });

      network.on('hoverNode', function(params) {
        if (state.mode !== 'dynasty') return;
        var node = nodes.get(params.node);
        if (!node) return;
        showHoverPanel(params.node);
      });

      network.on('blurNode', function() {
        if (state.mode === 'overview') return;
        scheduleHideHoverPanel();
      });

      if (network.body && network.body.container) {
        network.body.container.addEventListener('mouseleave', function() {
          hideOverviewEdgeTooltip();
        });
      }

      network.on('hoverEdge', function(params) {
        if (state.mode !== 'overview') return;
        var edge = edges.get(params.edge);
        if (!edge || !edge.isOverviewEdge) return;
        var domPoint = params && params.pointer && params.pointer.DOM ? params.pointer.DOM : null;
        showOverviewEdgeTooltipFromDom(edge, domPoint);
      });

      network.on('blurEdge', function() {
        if (state.mode !== 'overview') return;
        hideOverviewEdgeTooltip();
      });

      network.on('click', function(params) {
        if (state.mode !== 'overview' || suppressSelectionNavigation) return;
        if (pendingOverviewClickTimer) {
          clearTimeout(pendingOverviewClickTimer);
          pendingOverviewClickTimer = null;
        }
        if (params && params.nodes && params.nodes.length) {
          var clickedNode = nodes.get(params.nodes[0]);
          if (clickedNode && String(clickedNode.id).indexOf('dynasty:') === 0 && clickedNode.dynasty_id != null) {
            pendingOverviewClickTimer = setTimeout(function() {
              state.activeOverviewDynastyId = String(clickedNode.dynasty_id);
              refreshOverviewEdges();
              if (typeof network.unselectAll === 'function') {
                network.unselectAll();
              }
              pendingOverviewClickTimer = null;
            }, 220);
          }
          return;
        }
        pendingOverviewClickTimer = setTimeout(function() {
          if (state.activeOverviewDynastyId != null) {
            state.activeOverviewDynastyId = null;
            refreshOverviewEdges();
          }
          if (typeof network.unselectAll === 'function') {
            network.unselectAll();
          }
          pendingOverviewClickTimer = null;
        }, 220);
      });

      network.on('beforeDrawing', function(ctx) {
        drawOverviewBackground(ctx);
      });

      network.on('dragStart', function() {
        hideOverviewEdgeTooltip();
      });

      network.on('zoom', function() {
        hideOverviewEdgeTooltip();
      });

      network.on('dragEnd', function(params) {
        if (state.mode !== 'dynasty' || !params || !params.nodes || !params.nodes.length) return;
        var positions = network.getPositions(params.nodes);
        var store = manualPositionsForCurrentContext();
        params.nodes.forEach(function(nodeId) {
          var pos = positions[nodeId];
          if (!pos) return;
          store[String(nodeId)] = { x: pos.x, y: pos.y };
        });
      });

      var expandBtn = document.getElementById('maternal-expand-btn');
      var dynastyBtn = document.getElementById('maternal-dynasty-btn');
      var regionMapBtn = document.getElementById('maternal-region-map-btn');

      expandBtn.addEventListener('click', function(event) {
        event.preventDefault();
        event.stopPropagation();
        var node = currentHoveredNode();
        if (!node || !node.maternal_bridge) return;
        pushHistory();
        state.activeRegionMapNodeId = null;
        toggleExpandedAncestors(node.id);
        applyMode(true);
        showHoverPanel(node.id);
      });

      dynastyBtn.addEventListener('click', function(event) {
        event.preventDefault();
        event.stopPropagation();
        var node = currentHoveredNode();
        if (!node) return;
        pushHistory();
        state.activeRegionMapNodeId = null;
        openPatrilinealView(node.id);
        syncControls();
        hideHoverPanel();
        var dynastyId = normalizeSelectedDynasty();
        // Load the current house first, then extend only this requested
        // father line from the compact parent-data buckets.
        ensureDynastyGraph(dynastyId).then(function() {
          return ensurePatrilinealData(node.id);
        }).then(function() {
          applyMode(true);
        }).catch(function(error) {
          updateStatus('Could not load paternal line: ' + error.message);
        });
      });

      regionMapBtn.addEventListener('click', function(event) {
        event.preventDefault();
        event.stopPropagation();
        var node = currentHoveredNode();
        if (!node) return;
        pushHistory();
        openRegionMapForNode(node.id, null, false);
        syncControls();
      });

    }

    createControls();
    createMapChooser();
    createHoverPanel();
    createRegionMapModal();
    createRegionLegendPanel();
    syncControls();
    bindEvents();
    window.addEventListener('resize', updateRegionLegendPanelLayout);
    network.once('afterDrawing', hideLoadingOverlay);
    applyMode(true);
  }

  init();
})();
