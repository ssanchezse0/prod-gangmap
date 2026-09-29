const categories = [
	{ id: 'territories', name: 'Territorios', file: 'territories.3.json', color: '#e2764d', enabled: true },
	{ id: 'legal', name: 'Facciones', file: 'legal.3.json', color: '#6e9bc6', enabled: true },
	{ id: 'neighborhoods', name: 'Barrios', file: 'neighborhoods.json', color: '#d7ef70', enabled: false },
	{ id: 'heists', name: 'Atracos', file: 'heists.3.json', color: '#c28a55', enabled: false },
	{ id: 'restaurants', name: 'Locales', file: 'restaurants.3.json', color: '#cf83a1', enabled: false },
];

const VIEW_ONLY = true;

const elements = {
	mapStatus: document.querySelector('#map-status'),
	totalCount: document.querySelector('#total-count'),
	visibleCount: document.querySelector('#visible-count'),
	layerCount: document.querySelector('#layer-count'),
	layerTotal: document.querySelector('#layer-total'),
	layerList: document.querySelector('#layer-list'),
	locationList: document.querySelector('#location-list'),
	locationSearch: document.querySelector('#location-search'),
	resultCount: document.querySelector('#result-count'),
	sidebar: document.querySelector('#sidebar'),
	toast: document.querySelector('#toast'),
	drawControls: document.querySelector('#draw-controls'),
	drawHint: document.querySelector('#draw-hint'),
	exportDialog: document.querySelector('#export-dialog'),
	regionTitle: document.querySelector('#region-title'),
	regionJson: document.querySelector('#region-json'),
};

const locationRecords = [];
const categoryLayers = new Map();
const selectedCells = new Map();
const deletionStorageKey = 'infames.deleted-zones.v1';
let activeCategoryIds = new Set(categories.filter((category) => category.enabled).map((category) => category.id));
let map;
let drawing = false;
let drawLayer;
let toastTimeout;
let patternIndex = 0;

function loadDeletedRecordKeys() {
	try {
		const savedKeys = JSON.parse(localStorage.getItem(deletionStorageKey) || '[]');
		return new Set(Array.isArray(savedKeys) ? savedKeys : []);
	} catch {
		return new Set();
	}
}

const deletedRecordKeys = VIEW_ONLY ? new Set() : loadDeletedRecordKeys();
let gridReferenceZoom = 4;
const GRID_CELL_SIZE = 6;
const GRID_OFFSET_X = 4;

function escapeHTML(value = '') {
	return String(value).replace(/[&<>"']/g, (character) => ({
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		'"': '&quot;',
		"'": '&#39;',
	})[character]);
}

function validLink(value) {
	try {
		const url = new URL(value);
		return url.protocol === 'https:' ? url.href : '';
	} catch {
		return '';
	}
}

function createRecordKey(record, categoryId) {
	const coordinates = Array.isArray(record.latlngarray)
		? record.latlngarray.map((point) => `${point.lat},${point.lng}`).join(';')
		: '';
	return `${categoryId}:${record.title}:${coordinates}`;
}

function popupContent(record) {
	const category = categories.find((item) => item.id === record.categoryId);
	const notes = record.notes ? `<p class="popup-notes">${escapeHTML(record.notes)}</p>` : '';
	const href = validLink(record.wiki_link);
	const link = href ? `<a class="popup-link" href="${escapeHTML(href)}" target="_blank" rel="noreferrer">Abrir referencia ↗</a>` : '';
	const deleteButton = VIEW_ONLY ? '' : '<button class="popup-delete" type="button"><span class="delete-glyph" aria-hidden="true"></span>Eliminar zona</button>';
	return `<p class="popup-category">${escapeHTML(category.name)}</p><h3 class="popup-title">${escapeHTML(record.title)}</h3>${notes}${link}${deleteButton}`;
}

function applySquarePattern(feature, color) {
	const path = feature.getElement();
	const svg = path?.ownerSVGElement;
	if (!svg) return;

	let defs = svg.querySelector('defs[data-infames-patterns]');
	if (!defs) {
		defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
		defs.setAttribute('data-infames-patterns', 'true');
		svg.insertBefore(defs, svg.firstChild);
	}

	if (!feature._infamesPatternId) feature._infamesPatternId = `infames-grid-${++patternIndex}`;
	let pattern = defs.querySelector(`#${feature._infamesPatternId}`);
	if (!pattern) {
		pattern = document.createElementNS('http://www.w3.org/2000/svg', 'pattern');
		pattern.setAttribute('id', feature._infamesPatternId);
		pattern.setAttribute('width', '24');
		pattern.setAttribute('height', '24');
		pattern.setAttribute('patternUnits', 'userSpaceOnUse');

		const square = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
		square.setAttribute('width', '24');
		square.setAttribute('height', '24');
		square.setAttribute('fill', color);
		square.setAttribute('fill-opacity', '0.38');
		pattern.appendChild(square);

		const grid = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		grid.setAttribute('d', 'M 24 0 H 0 V 24');
		grid.setAttribute('fill', 'none');
		grid.setAttribute('stroke', '#dce9ee');
		grid.setAttribute('stroke-opacity', '0.7');
		grid.setAttribute('stroke-width', '1');
		pattern.appendChild(grid);
		defs.appendChild(pattern);
	}

	path.setAttribute('fill', `url(#${feature._infamesPatternId})`);
	path.setAttribute('fill-opacity', '1');
}

function createStaticGrid() {
	return L.gridLayer({ tileSize: 256, minZoom: 1, maxZoom: 7, noWrap: true, updateWhenIdle: true, keepBuffer: 1 });
}

const staticGrid = createStaticGrid();
staticGrid.createTile = (coordinates) => {
	const tile = document.createElement('canvas');
	tile.width = 256;
	tile.height = 256;
	tile.className = 'static-grid-tile';
	tile.style.pointerEvents = 'none';
	const context = tile.getContext('2d');
	const cellSize = GRID_CELL_SIZE * 2 ** (coordinates.z - gridReferenceZoom);
	const offsetX = GRID_OFFSET_X * 2 ** (coordinates.z - gridReferenceZoom);
	const originX = coordinates.x * 256;
	const originY = coordinates.y * 256;
	const firstX = Math.ceil((originX - offsetX) / cellSize) * cellSize + offsetX - originX;
	const firstY = Math.ceil(originY / cellSize) * cellSize - originY;
	context.strokeStyle = 'rgba(229, 240, 243, 0.48)';
	context.lineWidth = 1;
	context.beginPath();
	for (let x = firstX; x <= 256; x += cellSize) {
		context.moveTo(x, 0);
		context.lineTo(x, 256);
	}
	for (let y = firstY; y <= 256; y += cellSize) {
		context.moveTo(0, y);
		context.lineTo(256, y);
	}
	context.stroke();
	return tile;
};

function createFeature(record, category) {
	const points = Array.isArray(record.latlngarray)
		? record.latlngarray.map((point) => [Number(point.lat), Number(point.lng)]).filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng))
		: [];
	if (points.length === 0) return null;

	const color = /^([\da-f]{6})$/i.test(record.fillcolor || '') ? `#${record.fillcolor}` : category.color;
	const strokeColor = /^([\da-f]{6})$/i.test(record.strokecolor || '') ? `#${record.strokecolor}` : color;
	const options = { color: strokeColor, fillColor: color, fillOpacity: 0.26, opacity: 0.88, weight: 2 };
	const isArea = points.length > 2;
	const feature = isArea
		? L.polygon(points, options)
		: L.circleMarker(points[0], { ...options, radius: 6, fillOpacity: 0.85 });
	const entry = { ...record, categoryId: category.id, recordKey: createRecordKey(record, category.id), feature };
	feature.bindPopup(popupContent(entry), { maxWidth: 310 });
	feature.bindTooltip(escapeHTML(record.title), { sticky: true, direction: 'top', className: 'map-tooltip' });
	if (isArea) feature.on('add', () => applySquarePattern(feature, color));
	feature.on('mouseover', () => feature.setStyle({ weight: 3, opacity: 1 }));
	feature.on('mouseout', () => feature.setStyle({ weight: 2, opacity: 0.88 }));
	if (!VIEW_ONLY) {
		feature.on('popupopen', (event) => {
			const button = event.popup.getElement()?.querySelector('.popup-delete');
			if (button) button.onclick = () => deleteRecord(entry.recordKey);
		});
	}
	locationRecords.push(entry);
	return feature;
}

function renderLayers() {
	elements.layerList.innerHTML = categories.map((category) => {
		const enabled = activeCategoryIds.has(category.id);
		return `<label class="layer-option"><input type="checkbox" data-category="${category.id}" ${enabled ? 'checked' : ''}><span class="layer-swatch" style="background:${category.color}"></span><span class="layer-name">${escapeHTML(category.name)}</span><span class="layer-count">${categoryLayers.get(category.id)?.records.length ?? 0}</span></label>`;
	}).join('');
	elements.layerList.querySelectorAll('input').forEach((input) => {
		input.addEventListener('change', () => toggleCategory(input.dataset.category, input.checked));
	});
	updateStats();
}

function updateStats() {
	const visible = categories
		.filter((category) => activeCategoryIds.has(category.id))
		.reduce((total, category) => total + (categoryLayers.get(category.id)?.records.length ?? 0), 0);
	elements.totalCount.textContent = String(locationRecords.length).padStart(2, '0');
	elements.visibleCount.textContent = String(visible).padStart(2, '0');
	elements.layerCount.textContent = String(activeCategoryIds.size).padStart(2, '0');
	elements.layerTotal.textContent = String(categories.length).padStart(2, '0');
}

function renderLocations() {
	const query = elements.locationSearch.value.trim().toLocaleLowerCase();
	const matches = locationRecords.filter((record) => {
		const visible = activeCategoryIds.has(record.categoryId);
		return (visible || query.length > 0) && (!query || `${record.title} ${record.notes || ''}`.toLocaleLowerCase().includes(query));
	});
	const shown = matches.slice(0, 80);
	elements.resultCount.textContent = query && matches.length > 80 ? '80+' : String(matches.length).padStart(2, '0');
	elements.locationList.innerHTML = shown.length
		? shown.map((record, index) => {
			const category = categories.find((item) => item.id === record.categoryId);
			const row = `<button class="location-row" type="button" data-index="${index}"><span class="location-dot" style="color:${category.color};background:${category.color}"></span><span class="location-copy"><span class="location-title">${escapeHTML(record.title)}</span><span class="location-type">${escapeHTML(category.name)}</span></span><span class="location-arrow" aria-hidden="true">›</span></button>`;
			const deleteButton = `<button class="location-delete" type="button" data-index="${index}" aria-label="Eliminar ${escapeHTML(record.title)}" title="Eliminar zona"><span class="delete-glyph" aria-hidden="true"></span></button>`;
			return VIEW_ONLY ? row : `<div class="location-entry">${row}${deleteButton}</div>`;
		}).join('')
		: '<p class="empty-state">No hay coincidencias en las capas visibles.</p>';
	elements.locationList.querySelectorAll('.location-row').forEach((button, index) => {
		button.addEventListener('click', () => focusRecord(shown[index]));
	});
	if (!VIEW_ONLY) {
		elements.locationList.querySelectorAll('.location-delete').forEach((button, index) => {
			button.addEventListener('click', () => deleteRecord(shown[index].recordKey));
		});
	}
}

function toggleCategory(categoryId, enabled) {
	const layer = categoryLayers.get(categoryId)?.layer;
	if (!layer) return;
	if (enabled) {
		activeCategoryIds.add(categoryId);
		layer.addTo(map);
	} else {
		activeCategoryIds.delete(categoryId);
		layer.removeFrom(map);
	}
	renderLocations();
	updateStats();
}

function focusRecord(record) {
	if (!activeCategoryIds.has(record.categoryId)) {
		activeCategoryIds.add(record.categoryId);
		categoryLayers.get(record.categoryId).layer.addTo(map);
		renderLayers();
	}
	if (record.feature.getBounds) {
		map.fitBounds(record.feature.getBounds(), { maxZoom: 5, padding: [50, 50] });
	} else {
		map.setView(record.feature.getLatLng(), 5);
	}
	record.feature.openPopup();
	if (window.innerWidth <= 720) elements.sidebar.classList.remove('is-open');
}

function fitVisible() {
	const bounds = L.latLngBounds([]);
	categories.forEach((category) => {
		if (!activeCategoryIds.has(category.id)) return;
		const layer = categoryLayers.get(category.id)?.layer;
		if (layer?.getLayers().length) bounds.extend(layer.getBounds());
	});
	if (bounds.isValid()) map.fitBounds(bounds, { maxZoom: 4, paddingTopLeft: window.innerWidth <= 720 ? [32, 32] : [370, 45], paddingBottomRight: [45, 45] });
}

function showToast(message) {
	elements.toast.textContent = message;
	elements.toast.classList.add('is-visible');
	window.clearTimeout(toastTimeout);
	toastTimeout = window.setTimeout(() => elements.toast.classList.remove('is-visible'), 2800);
}

function deleteRecord(recordKey) {
	if (VIEW_ONLY) return;
	const index = locationRecords.findIndex((record) => record.recordKey === recordKey);
	if (index < 0) return;
	const record = locationRecords[index];
	if (!window.confirm(`¿Eliminar la zona "${record.title}" de este navegador?`)) return;

	const category = categoryLayers.get(record.categoryId);
	category.layer.removeLayer(record.feature);
	category.records = category.records.filter((item) => item.recordKey !== recordKey);
	locationRecords.splice(index, 1);
	deletedRecordKeys.add(recordKey);
	try {
		localStorage.setItem(deletionStorageKey, JSON.stringify([...deletedRecordKeys]));
		showToast('Zona eliminada y guardada en este navegador.');
	} catch {
		showToast('Zona eliminada hasta cerrar este navegador.');
	}
	renderLayers();
	renderLocations();
}

function startDrawing() {
	if (VIEW_ONLY) return;
	if (drawing) return;
	drawing = true;
	selectedCells.clear();
	drawLayer = L.layerGroup().addTo(map);
	gridReferenceZoom = map.getZoom();
	staticGrid.redraw();
	staticGrid.addTo(map);
	map.getContainer().classList.add('is-drawing');
	elements.drawControls.hidden = false;
	updateDrawPreview();
	document.querySelector('#draw-region').textContent = 'Seleccionando cuadrados';
	if (window.innerWidth <= 720) elements.sidebar.classList.remove('is-open');
}

function cancelDrawing() {
	if (drawLayer) map.removeLayer(drawLayer);
	map.removeLayer(staticGrid);
	drawLayer = null;
	selectedCells.clear();
	drawing = false;
	map.getContainer().classList.remove('is-drawing');
	elements.drawControls.hidden = true;
	document.querySelector('#draw-region').textContent = '+ Nueva zona';
}

function getCellBounds(column, row) {
	const left = column * GRID_CELL_SIZE + GRID_OFFSET_X;
	const right = (column + 1) * GRID_CELL_SIZE + GRID_OFFSET_X;
	const topLeft = map.unproject(L.point(left, row * GRID_CELL_SIZE), gridReferenceZoom);
	const bottomRight = map.unproject(L.point(right, (row + 1) * GRID_CELL_SIZE), gridReferenceZoom);
	return L.latLngBounds(topLeft, bottomRight);
}

function toggleGridCell(latlng) {
	const projected = map.project(latlng, gridReferenceZoom);
	const column = Math.floor((projected.x - GRID_OFFSET_X) / GRID_CELL_SIZE);
	const row = Math.floor(projected.y / GRID_CELL_SIZE);
	const key = `${column}:${row}`;
	const existing = selectedCells.get(key);
	if (existing) {
		drawLayer.removeLayer(existing.layer);
		selectedCells.delete(key);
	} else {
		const layer = L.rectangle(getCellBounds(column, row), {
			color: '#dce9ee',
			weight: 1,
			opacity: 0.95,
			fillColor: '#36a9f2',
			fillOpacity: 0.58,
			interactive: false,
		}).addTo(drawLayer);
		selectedCells.set(key, { column, row, layer });
	}
	updateDrawPreview();
}

function traceSelectedBoundary() {
	const edges = new Map();
	const addEdge = (from, to) => {
		const key = `${from.x},${from.y}>${to.x},${to.y}`;
		const reverse = `${to.x},${to.y}>${from.x},${from.y}`;
		if (edges.has(reverse)) edges.delete(reverse);
		else edges.set(key, { from, to });
	};

	selectedCells.forEach(({ column, row }) => {
		const topLeft = { x: column, y: row };
		const topRight = { x: column + 1, y: row };
		const bottomRight = { x: column + 1, y: row + 1 };
		const bottomLeft = { x: column, y: row + 1 };
		addEdge(topLeft, topRight);
		addEdge(topRight, bottomRight);
		addEdge(bottomRight, bottomLeft);
		addEdge(bottomLeft, topLeft);
	});

	const loops = [];
	while (edges.size) {
		const first = edges.values().next().value;
		const start = first.from;
		const loop = [];
		let edge = first;
		let closed = false;
		const maxSteps = edges.size;
		for (let count = 0; count <= maxSteps; count++) {
			edges.delete(`${edge.from.x},${edge.from.y}>${edge.to.x},${edge.to.y}`);
			loop.push(edge.from);
			if (edge.to.x === start.x && edge.to.y === start.y) {
				closed = true;
				break;
			}

			const candidates = [...edges.values()].filter((candidate) => candidate.from.x === edge.to.x && candidate.from.y === edge.to.y);
			if (candidates.length === 0) break;
			const direction = (candidate) => {
				if (candidate.to.x > candidate.from.x) return 0;
				if (candidate.to.y > candidate.from.y) return 1;
				if (candidate.to.x < candidate.from.x) return 2;
				return 3;
			};
			const incoming = direction(edge);
			const turnPriority = [1, 0, 3, 2];
			candidates.sort((left, right) => turnPriority.indexOf((direction(left) - incoming + 4) % 4) - turnPriority.indexOf((direction(right) - incoming + 4) % 4));
			edge = candidates[0];
		}
		if (!closed) return null;
		loops.push(loop);
	}
	return loops.length === 1 ? loops[0] : null;
}

function updateDrawPreview() {
	elements.drawHint.textContent = `${selectedCells.size} cuadrado${selectedCells.size === 1 ? '' : 's'} seleccionado${selectedCells.size === 1 ? '' : 's'} · clic para rellenar o quitar`;
	document.querySelector('#finish-region').textContent = `Exportar zona (${selectedCells.size})`;
}

function exportRegion() {
	if (VIEW_ONLY) return;
	if (selectedCells.size === 0) {
		showToast('Rellena al menos un cuadrado para crear la zona.');
		return;
	}
	const boundary = traceSelectedBoundary();
	if (!boundary) {
		showToast('La zona debe ser continua y sin huecos; rellena las celdas interiores.');
		return;
	}
	const region = {
		type: 'Territories',
		title: elements.regionTitle.value.trim() || 'Nueva zona',
		notes: '',
		wiki_link: '',
		order: 0,
		strokecolor: 'E2764D',
		fillcolor: 'E2764D',
		latlngarray: boundary.map(({ x, y }) => {
			const point = map.unproject(L.point(x * GRID_CELL_SIZE + GRID_OFFSET_X, y * GRID_CELL_SIZE), gridReferenceZoom);
			return { lat: Number(point.lat.toFixed(3)), lng: Number(point.lng.toFixed(3)) };
		}),
	};
	elements.regionJson.value = JSON.stringify(region, null, 2);
	elements.exportDialog.hidden = false;
	elements.regionTitle.focus();
	cancelDrawing();
}

async function loadCategory(category) {
	const response = await fetch(`data/${category.file}?v=${Date.now()}`, { cache: 'no-store' });
	if (!response.ok) throw new Error(`No se pudo cargar ${category.file}`);
	const records = await response.json();
	const layer = L.featureGroup();
	records.forEach((record) => {
		if (deletedRecordKeys.has(createRecordKey(record, category.id))) return;
		const feature = createFeature(record, category);
		if (feature) layer.addLayer(feature);
	});
	categoryLayers.set(category.id, { layer, records: locationRecords.filter((record) => record.categoryId === category.id) });
	if (activeCategoryIds.has(category.id)) layer.addTo(map);
}

async function initialize() {
	map = L.map('map', { zoomControl: false, minZoom: 1, maxZoom: 7, doubleClickZoom: false }).setView([-60, -20], 3);
	L.tileLayer('https://media.githubusercontent.com/media/LowS1312/inf-gangmap/main/tiles/atlas/{z}/{x}_{y}.png', {
		minZoom: 1,
		maxZoom: 7,
		maxNativeZoom: 7,
		attribution: '<a href="https://github.com/LowS1312/inf-gangmap" target="_blank" rel="noreferrer">Atlas Infames</a>',
	}).addTo(map);
	L.control.zoom({ position: 'bottomright' }).addTo(map);
	map.on('click', (event) => {
		if (!drawing) return;
		toggleGridCell(event.latlng);
	});
	map.on('tileerror', () => {
		elements.mapStatus.textContent = 'Atlas no disponible';
	});

	try {
		await Promise.all(categories.map(loadCategory));
		renderLayers();
		renderLocations();
		fitVisible();
		elements.mapStatus.textContent = 'Atlas conectado';
	} catch (error) {
		elements.mapStatus.textContent = 'Error al cargar datos';
		showToast(error.message);
	}
}

elements.locationSearch.addEventListener('input', renderLocations);
document.querySelector('#fit-map').addEventListener('click', fitVisible);
document.querySelector('#draw-region').addEventListener('click', startDrawing);
document.querySelector('#cancel-region').addEventListener('click', cancelDrawing);
document.querySelector('#finish-region').addEventListener('click', exportRegion);
document.querySelector('#panel-toggle').addEventListener('click', () => elements.sidebar.classList.toggle('is-open'));
document.querySelector('#close-dialog').addEventListener('click', () => { elements.exportDialog.hidden = true; });
document.querySelector('#close-export').addEventListener('click', () => { elements.exportDialog.hidden = true; });
document.querySelector('#copy-json').addEventListener('click', async () => {
	try {
		await navigator.clipboard.writeText(elements.regionJson.value);
		showToast('JSON copiado al portapapeles.');
	} catch {
		elements.regionJson.select();
		document.execCommand('copy');
		showToast('JSON seleccionado para copiar.');
	}
});
elements.regionTitle.addEventListener('input', () => {
	if (!elements.exportDialog.hidden) {
		try {
			const region = JSON.parse(elements.regionJson.value);
			region.title = elements.regionTitle.value.trim() || 'Nueva zona';
			elements.regionJson.value = JSON.stringify(region, null, 2);
		} catch {
			return;
		}
	}
});
elements.exportDialog.addEventListener('click', (event) => {
	if (event.target === elements.exportDialog) elements.exportDialog.hidden = true;
});
document.addEventListener('keydown', (event) => {
	if (event.key === 'Escape') {
		if (drawing) cancelDrawing();
		elements.exportDialog.hidden = true;
		elements.sidebar.classList.remove('is-open');
	}
});

if (window.L) initialize();
