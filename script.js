document.addEventListener('DOMContentLoaded', () => {
    
    const STORAGE_KEY = 'drawnPolygons';

    // --- Map Initialization ---
    const map = L.map('map', {
        // zoomControl: false // Optional: disable zoom controls
    }).setView([51.505, -0.09], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    // --- Layer Group ---
    const drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);

    // --- Leaflet.Draw Handlers Initialization ---
    const drawOptions = {
        edit: {
            featureGroup: drawnItems 
        },
        draw: {
            polygon: {
                allowIntersection: false,
                showArea: true,
                drawError: { color: '#e1e100', message: 'Self-intersections not allowed!' },
                shapeOptions: { color: '#007bff' }
            },
            polyline: false, rectangle: false, circle: false, marker: false, circlemarker: false
        }
    };

    // Create the draw control and add it to the map
    const drawControl = new L.Control.Draw(drawOptions);
    map.addControl(drawControl);

    // --- Helper function to trigger file download ---
    function triggerDownload(filename, content, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        document.body.appendChild(link); // Required for Firefox
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
    }

    // --- Custom Export Control Definition ---
    L.Control.Export = L.Control.extend({
        onAdd: function(currentMap) { // Use function parameter to avoid potential scope issues
            const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom export-control-container');
            L.DomEvent.disableClickPropagation(container); 

            // GeoJSON Button
            const geoJsonButton = L.DomUtil.create('a', 'export-geojson-button', container);
            geoJsonButton.innerHTML = 'GeoJ'; 
            geoJsonButton.href = '#';
            geoJsonButton.title = 'Save as GeoJSON';

            L.DomEvent.on(geoJsonButton, 'click', L.DomEvent.stop);
            L.DomEvent.on(geoJsonButton, 'click', () => {
                const geoJsonData = drawnItems.toGeoJSON();
                const fileContent = JSON.stringify(geoJsonData, null, 2);
                triggerDownload('polygons.geojson', fileContent, 'application/geo+json');
            }); // Removed 'this' - not needed with arrow function

            // CSV Button
            const csvButton = L.DomUtil.create('a', 'export-csv-button', container);
            csvButton.innerHTML = 'CSV'; 
            csvButton.href = '#';
            csvButton.title = 'Save as CSV';

            L.DomEvent.on(csvButton, 'click', L.DomEvent.stop);
            L.DomEvent.on(csvButton, 'click', () => {
                const geoJsonData = drawnItems.toGeoJSON();
                let csvContent = "polygon_id,point_index,latitude,longitude\n";
                geoJsonData.features.forEach((feature) => {
                    if (feature.geometry && feature.geometry.type === 'Polygon') {
                        const polygonId = feature.properties.id || 'unknown';
                        const coordinates = feature.geometry.coordinates[0]; 
                        coordinates.forEach((point, index) => {
                            const lat = point[1];
                            const lon = point[0];
                            csvContent += `${polygonId},${index},${lat},${lon}\n`;
                        });
                    }
                });
                triggerDownload('polygons.csv', csvContent, 'text/csv;charset=utf-8;');
            }); 

            // Send Data Button (for TMA)
            const sendDataButton = L.DomUtil.create('a', 'send-data-button', container);
            sendDataButton.innerHTML = 'Send'; // Short text
            sendDataButton.href = '#';
            sendDataButton.title = 'Send Polygon Data to Bot';
            // Hide initially, show only if TMA context detected
            sendDataButton.style.display = 'none'; 

            L.DomEvent.on(sendDataButton, 'click', L.DomEvent.stop);
            L.DomEvent.on(sendDataButton, 'click', () => {
                const geoJsonData = drawnItems.toGeoJSON();
                if (geoJsonData.features.length === 0) {
                    Telegram.WebApp.showAlert('Please draw at least one polygon before sending.');
                    return;
                }
                const dataString = JSON.stringify(geoJsonData);
                // Check if data exceeds Telegram's limit (4096 bytes)
                if (dataString.length > 4096) {
                     Telegram.WebApp.showAlert('Data size exceeds Telegram limit (4096 bytes). Please simplify polygons or send fewer at a time.');
                } else {
                    Telegram.WebApp.sendData(dataString);
                    // Optionally close the Mini App after sending
                    // Telegram.WebApp.close();
                }
            });

            // Show Send button only if running inside Telegram Mini App
            if (Telegram.WebApp && Telegram.WebApp.initData) {
                 sendDataButton.style.display = 'block';
            }

            return container;
        },

        onRemove: function(currentMap) {
            // Nothing needed here for now
        }
    });

    // --- Add Custom Export Control Instance ---
    map.addControl(new L.Control.Export({ position: 'bottomleft' })); 

    // --- Local Storage Functions ---
    function savePolygons() {
        const geoJsonData = drawnItems.toGeoJSON();
        geoJsonData.features.forEach((feature, index) => {
            if (!feature.properties) {
                feature.properties = {};
            }
            feature.properties.id = feature.properties.id || Date.now() + index;
        });
        localStorage.setItem(STORAGE_KEY, JSON.stringify(geoJsonData));
        console.log('Polygons saved:', geoJsonData);
    }

    function loadPolygons() {
        const data = localStorage.getItem(STORAGE_KEY);
        if (data) {
            try {
                const geoJsonData = JSON.parse(data);
                L.geoJSON(geoJsonData, {
                    style: function (feature) {
                        return feature.properties.style || { color: '#007bff', weight: 2, opacity: 1, fillOpacity: 0.3 };
                    },
                    onEachFeature: function (feature, layer) {
                        layer.feature = feature;
                        let exists = false;
                        drawnItems.eachLayer(l => {
                            if (l.feature && l.feature.properties && l.feature.properties.id === feature.properties.id) {
                                exists = true;
                            }
                        });
                        if (!exists) {
                            drawnItems.addLayer(layer);
                        }
                    }
                });
                console.log('Polygons loaded:', geoJsonData);
            } catch (e) {
                console.error("Error loading polygons from localStorage:", e);
                localStorage.removeItem(STORAGE_KEY);
            }
        }
    }

    // --- Map Event Handlers ---
    map.on(L.Draw.Event.CREATED, function (event) {
        const layer = event.layer;
        layer.feature = layer.toGeoJSON();
        layer.feature.properties = layer.feature.properties || {};
        layer.feature.properties.id = Date.now();
        drawnItems.addLayer(layer);
        savePolygons();
    });

    map.on(L.Draw.Event.EDITED, function (event) {
        savePolygons();
        console.log('Polygons edited and saved.');
    });

    map.on(L.Draw.Event.DELETED, function (event) {
        savePolygons();
        console.log('Polygons deleted and state saved.');
    });

    // --- Initial Load & TMA Ready Signal ---
    loadPolygons();
    // Signal to Telegram that the app is ready
    if (Telegram.WebApp) {
        Telegram.WebApp.ready();
    }

});