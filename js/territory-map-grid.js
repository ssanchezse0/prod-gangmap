const categories = [
	{ id: 'territories', name: 'Territorios', file: 'territories.3.json', color: '#e2764d', enabled: true },
	{ id: 'legal', name: 'Facciones', file: 'legal.3.json', color: '#6e9bc6', enabled: true },
	{ id: 'neighborhoods', name: 'Barrios', file: 'neighborhoods.json', color: '#d7ef70', enabled: false },
	{ id: 'heists', name: 'Atracos', file: 'heists.3.json', color: '#c28a55', enabled: false },
	{ id: 'restaurants', name: 'Locales', file: 'restaurants.3.json', color: '#cf83a1', enabled: false },
];

const supabaseConfig = window.SUPABASE_CONFIG || {};
const supabaseKey = supabaseConfig.publicKey || supabaseConfig.anonKey || '';
const supabaseClient = window.supabase?.createClient && supabaseConfig.url && supabaseKey
	? window.supabase.createClient(supabaseConfig.url, supabaseKey)
	: null;
let isAdmin = false;
let editingRecord = null;

const elements = {
	mapStatus: document.querySelector('#map-status'),
	totalCount: document.querySelector('#total-count'),
	visibleCount: document.querySelector('#visible-count'),
	layerCount: document.querySelector('#layer-count'),
	layerTotal: document.querySelector('#layer-total'),
	drawRegion: document.querySelector('#draw-region'),
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
	regionNotes: document.querySelector('#region-notes'),
	regionJson: document.querySelector('#region-json'),
	saveRegion: document.querySelector('#save-region'),
	adminToggle: document.querySelector('#admin-toggle'),
	adminDialog: document.querySelector('#admin-dialog'),
	adminForm: document.querySelector('#admin-form'),
	adminEmail: document.querySelector('#admin-email'),
	adminPassword: document.querySelector('#admin-password'),
	adminError: document.querySelector('#admin-error'),
};

const locationRecords = [];
const categoryLayers = new Map();
const selectedCells = new Map();
let activeCategoryIds = new Set(categories.filter((category) => category.enabled).map((category) => category.id));
let map;
let drawing = false;
let drawLayer;
let toastTimeout;
let patternIndex = 0;

let gridReferenceZoom = 4;
let gridOffsetReferenceZoom = 4;
const GRID_CELL_SIZE = 4;
const GRID_OFFSET_X = 4;
const MAX_GRID_CELLS = 20000;

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
	const editButton = isAdmin ? '<button class="popup-edit" type="button">Editar zona</button>' : '';
	const deleteButton = isAdmin ? '<button class="popup-delete" type="button"><span class="delete-glyph" aria-hidden="true"></span>Eliminar zona</button>' : '';
	return `<p class="popup-category">${escapeHTML(category.name)}</p><h3 class="popup-title">${escapeHTML(record.title)}</h3>${notes}${link}${editButton}${deleteButton}`;
}

function applySquarePattern(feature, color) {
	const path = feature.getElement();
	const svg = path?.ownerSVGElement;
	if (!svg) return;

	let defs = svg.querySelector('defs[data-prodigy-patterns]');
	if (!defs) {
		defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
		defs.setAttribute('data-prodigy-patterns', 'true');
		svg.insertBefore(defs, svg.firstChild);
	}

	if (!feature._prodigyPatternId) feature._prodigyPatternId = `prodigy-grid-${++patternIndex}`;
	let pattern = defs.querySelector(`#${feature._prodigyPatternId}`);
	if (!pattern) {
		pattern = document.createElementNS('http://www.w3.org/2000/svg', 'pattern');
		pattern.setAttribute('id', feature._prodigyPatternId);
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

	path.setAttribute('fill', `url(#${feature._prodigyPatternId})`);
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
	const offsetX = GRID_OFFSET_X * 2 ** (coordinates.z - gridOffsetReferenceZoom);
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
	feature.on('popupopen', (event) => {
		const popup = event.popup.getElement();
		const editButton = popup?.querySelector('.popup-edit');
		const deleteButton = popup?.querySelector('.popup-delete');
		if (editButton) editButton.onclick = () => startDrawing(entry);
		if (deleteButton) deleteButton.onclick = () => deleteRecord(entry.recordKey);
	});
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
			if (isAdmin) return `<div class="location-entry">${row}<button class="location-edit" type="button" data-index="${index}" aria-label="Editar ${escapeHTML(record.title)}" title="Editar zona">Editar</button><button class="location-delete" type="button" data-index="${index}" aria-label="Eliminar ${escapeHTML(record.title)}" title="Eliminar zona"><span class="delete-glyph" aria-hidden="true"></span></button></div>`;
			return row;
		}).join('')
		: '<p class="empty-state">No hay coincidencias en las capas visibles.</p>';
	elements.locationList.querySelectorAll('.location-row').forEach((button, index) => {
		button.addEventListener('click', () => focusRecord(shown[index]));
	});
	if (isAdmin) {
		elements.locationList.querySelectorAll('.location-edit').forEach((button, index) => {
			button.addEventListener('click', () => startDrawing(shown[index]));
		});
		elements.locationList.querySelectorAll('.location-delete').forEach((button, index) => {
			button.addEventListener('click', () => deleteRecord(shown[index].recordKey));
		});
	}
}

function setAdminAccess(enabled) {
	isAdmin = enabled;
	elements.drawRegion.hidden = !enabled;
	elements.drawRegion.disabled = !enabled;
	elements.adminToggle.textContent = enabled ? 'Cerrar sesión' : 'Acceso admin';
	if (!enabled && drawing) cancelDrawing();
	locationRecords.forEach((record) => record.feature.setPopupContent(popupContent(record)));
	renderLocations();
}

async function verifyAdmin(user) {
	const { data, error } = await supabaseClient
		.from('zone_admins')
		.select('user_id')
		.eq('user_id', user.id)
		.maybeSingle();
	if (error || !data) {
		await supabaseClient.auth.signOut();
		setAdminAccess(false);
		elements.adminError.textContent = error ? error.message : 'Esta cuenta no tiene permiso de edición.';
		elements.adminError.hidden = false;
		return false;
	}
	setAdminAccess(true);
	elements.adminDialog.hidden = true;
	elements.adminPassword.value = '';
	return true;
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

async function deleteRecord(recordKey) {
	if (!isAdmin || !supabaseClient) return;
	const index = locationRecords.findIndex((record) => record.recordKey === recordKey);
	if (index < 0) return;
	const record = locationRecords[index];
	if (!record.id) {
		showToast('Esta zona aún no está guardada en la base de datos.');
		return;
	}
	if (!window.confirm(`¿Eliminar la zona "${record.title}" para todos los visitantes?`)) return;
	const { error } = await supabaseClient.from('zones').delete().eq('id', record.id);
	if (error) {
		showToast(error.message);
		return;
	}

	const category = categoryLayers.get(record.categoryId);
	category.layer.removeLayer(record.feature);
	category.records = category.records.filter((item) => item.recordKey !== recordKey);
	locationRecords.splice(index, 1);
	showToast('Zona eliminada para todos los visitantes.');
	renderLayers();
	renderLocations();
}

function startDrawing(record = null) {
	if (!isAdmin) return;
	if (!map || !window.L) {
		showToast('El mapa todavía está cargando. Inténtalo de nuevo en unos segundos.');
		return;
	}
	if (drawing) return;
	if (record?.feature?.getBounds) map.fitBounds(record.feature.getBounds(), { maxZoom: 7, padding: [48, 48], animate: false });
	drawing = true;
	editingRecord = record;
	selectedCells.clear();
	drawLayer = L.layerGroup().addTo(map);
	gridReferenceZoom = map.getZoom() - 1;
	gridOffsetReferenceZoom = gridReferenceZoom;
	staticGrid.redraw();
	staticGrid.addTo(map);
	map.getContainer().classList.add('is-drawing');
	elements.drawControls.hidden = false;
	elements.regionTitle.value = record?.title || 'Nueva zona';
	elements.regionNotes.value = record?.notes || '';
	updateDrawPreview();
	document.querySelector('#draw-region').textContent = record ? 'Editando zona' : 'Seleccionando cuadrados';
	if (record) selectRecordCells(record);
	if (window.innerWidth <= 720) elements.sidebar.classList.remove('is-open');
}

function cancelDrawing(preserveEdit = false) {
	if (drawLayer) map.removeLayer(drawLayer);
	map.removeLayer(staticGrid);
	drawLayer = null;
	selectedCells.clear();
	drawing = false;
	map.getContainer().classList.remove('is-drawing');
	elements.drawControls.hidden = true;
	document.querySelector('#draw-region').textContent = '+ Nueva zona';
	if (!preserveEdit) editingRecord = null;
}

function getCellBounds(column, row) {
	const offsetX = GRID_OFFSET_X * 2 ** (gridReferenceZoom - gridOffsetReferenceZoom);
	const left = column * GRID_CELL_SIZE + offsetX;
	const right = (column + 1) * GRID_CELL_SIZE + offsetX;
	const topLeft = map.unproject(L.point(left, row * GRID_CELL_SIZE), gridReferenceZoom);
	const bottomRight = map.unproject(L.point(right, (row + 1) * GRID_CELL_SIZE), gridReferenceZoom);
	return L.latLngBounds(topLeft, bottomRight);
}

function setGridCell(column, row, refreshPreview = true) {
	const key = `${column}:${row}`;
	if (selectedCells.has(key)) return;
	const layer = L.rectangle(getCellBounds(column, row), {
		color: '#dce9ee',
		weight: 1,
		opacity: 0.95,
		fillColor: '#36a9f2',
		fillOpacity: 0.58,
		interactive: false,
	}).addTo(drawLayer);
	selectedCells.set(key, { column, row, layer });
	if (refreshPreview) updateDrawPreview();
}

function toggleGridCell(latlng) {
	const projected = map.project(latlng, gridReferenceZoom);
	const offsetX = GRID_OFFSET_X * 2 ** (gridReferenceZoom - gridOffsetReferenceZoom);
	const column = Math.floor((projected.x - offsetX) / GRID_CELL_SIZE);
	const row = Math.floor(projected.y / GRID_CELL_SIZE);
	const key = `${column}:${row}`;
	const existing = selectedCells.get(key);
	if (existing) {
		drawLayer.removeLayer(existing.layer);
		selectedCells.delete(key);
	} else {
		setGridCell(column, row);
	}
	updateDrawPreview();
}

function pointInPolygon(point, polygon) {
	let inside = false;
	for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
		const current = polygon[index];
		const prior = polygon[previous];
		const crosses = current.y > point.y !== prior.y > point.y;
		if (crosses && point.x < ((prior.x - current.x) * (point.y - current.y)) / (prior.y - current.y) + current.x) inside = !inside;
	}
	return inside;
}

function selectRecordCells(record) {
	const polygon = (record.latlngarray || []).map((point) => {
		const projected = map.project([point.lat, point.lng], gridReferenceZoom);
		return { x: projected.x, y: projected.y };
	});
	if (polygon.length < 3) return;
	const offsetX = GRID_OFFSET_X * 2 ** (gridReferenceZoom - gridOffsetReferenceZoom);
	const columns = polygon.map((point) => Math.floor((point.x - offsetX) / GRID_CELL_SIZE));
	const rows = polygon.map((point) => Math.floor(point.y / GRID_CELL_SIZE));
	const minColumn = Math.min(...columns);
	const maxColumn = Math.max(...columns);
	const minRow = Math.min(...rows);
	const maxRow = Math.max(...rows);
	if ((maxColumn - minColumn + 1) * (maxRow - minRow + 1) > MAX_GRID_CELLS) {
		showToast('Acerca el mapa antes de editar esta zona.');
		return;
	}
	for (let row = minRow; row <= maxRow; row++) {
		for (let column = minColumn; column <= maxColumn; column++) {
			const center = { x: column * GRID_CELL_SIZE + offsetX + GRID_CELL_SIZE / 2, y: row * GRID_CELL_SIZE + GRID_CELL_SIZE / 2 };
			if (pointInPolygon(center, polygon)) setGridCell(column, row, false);
		}
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
	document.querySelector('#finish-region').textContent = `${editingRecord ? 'Preparar cambios' : 'Preparar zona'} (${selectedCells.size})`;
}

function exportRegion() {
	if (!isAdmin || !supabaseClient) return;
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
		_legacyRecordKey: editingRecord?._legacyRecordKey,
		type: editingRecord?.type || 'Territories',
		title: elements.regionTitle.value.trim() || 'Nueva zona',
		notes: elements.regionNotes.value.trim(),
		wiki_link: editingRecord?.wiki_link || '',
		order: editingRecord?.order || 0,
		strokecolor: editingRecord?.strokecolor || 'E2764D',
		fillcolor: editingRecord?.fillcolor || 'E2764D',
		latlngarray: boundary.map(({ x, y }) => {
			const offsetX = GRID_OFFSET_X * 2 ** (gridReferenceZoom - gridOffsetReferenceZoom);
			const point = map.unproject(L.point(x * GRID_CELL_SIZE + offsetX, y * GRID_CELL_SIZE), gridReferenceZoom);
			return { lat: Number(point.lat.toFixed(3)), lng: Number(point.lng.toFixed(3)) };
		}),
	};
	elements.regionJson.value = JSON.stringify(region, null, 2);
	elements.exportDialog.hidden = false;
	elements.saveRegion.hidden = false;
	elements.saveRegion.disabled = false;
	elements.regionTitle.focus();
	cancelDrawing(true);
}

async function saveRegion() {
	if (!isAdmin || !supabaseClient) return;
	let region;
	try {
		region = JSON.parse(elements.regionJson.value);
	} catch {
		showToast('No se pudo leer la zona generada.');
		return;
	}
	const categoryId = editingRecord?.categoryId || 'territories';
	const categoryState = categoryLayers.get(categoryId);
	const category = categories.find((item) => item.id === categoryId);
	const pointsAreValid = Array.isArray(region.latlngarray)
		&& region.latlngarray.length >= 3
		&& region.latlngarray.every((point) => Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lng)));
	if (!map || !categoryState?.layer || !category || !pointsAreValid) {
		showToast('El mapa aún no está listo o la zona no tiene coordenadas válidas.');
		return;
	}
	let result;
	if (editingRecord?.id) {
		result = await supabaseClient.from('zones').update({ data: region }).eq('id', editingRecord.id).select('id, data').single();
	} else {
		const data = editingRecord ? { ...region, _legacyRecordKey: editingRecord.recordKey } : region;
		result = await supabaseClient.from('zones').insert({ category: categoryId, data }).select('id, data').single();
	}
	if (result.error) {
		showToast(result.error.message);
		return;
	}

	if (editingRecord) {
		if (editingRecord.feature) categoryState.layer.removeLayer(editingRecord.feature);
		const recordIndex = locationRecords.indexOf(editingRecord);
		if (recordIndex >= 0) locationRecords.splice(recordIndex, 1);
		categoryState.records = categoryState.records.filter((record) => record !== editingRecord);
	}
	const savedRecord = { ...result.data.data, id: result.data.id };
	const feature = createFeature(savedRecord, category);
	if (!feature) {
		showToast('Supabase guardó la zona, pero sus coordenadas no se pudieron dibujar.');
		return;
	}
	categoryState.layer.addLayer(feature);
	const savedEntry = locationRecords[locationRecords.length - 1];
	if (!savedEntry) {
		categoryState.layer.removeLayer(feature);
		showToast('No se pudo actualizar la lista de zonas.');
		return;
	}
	categoryState.records.push(savedEntry);
	if (!activeCategoryIds.has(categoryId)) {
		activeCategoryIds.add(categoryId);
		categoryState.layer.addTo(map);
	}
	elements.exportDialog.hidden = true;
	elements.saveRegion.hidden = true;
	elements.regionNotes.value = '';
	editingRecord = null;
	renderLayers();
	renderLocations();
	fitVisible();
	showToast('Zona guardada para todos los visitantes.');
}

async function loadCategory(category) {
	let records;
	if (supabaseClient) {
		const { data, error } = await supabaseClient.from('zones').select('id, data').eq('category', category.id).order('created_at');
		const response = await fetch(`data/${category.file}?v=${Date.now()}`, { cache: 'no-store' });
		if (!response.ok && error) throw new Error(`No se pudo cargar ${category.file}`);
		const localRecords = response.ok ? await response.json() : [];
		if (error) records = localRecords;
		else {
			const replacedKeys = new Set(data.map((record) => record.data._legacyRecordKey).filter(Boolean));
			records = [
				...localRecords.filter((record) => !replacedKeys.has(createRecordKey(record, category.id))),
				...data.map((record) => ({ ...record.data, id: record.id })),
			];
		}
	} else {
		const response = await fetch(`data/${category.file}?v=${Date.now()}`, { cache: 'no-store' });
		if (!response.ok) throw new Error(`No se pudo cargar ${category.file}`);
		records = await response.json();
	}
	const layer = L.featureGroup();
	records.forEach((record) => {
		const feature = createFeature(record, category);
		if (feature) layer.addLayer(feature);
	});
	categoryLayers.set(category.id, { layer, records: locationRecords.filter((record) => record.categoryId === category.id) });
	if (activeCategoryIds.has(category.id)) layer.addTo(map);
}

async function initialize() {
	map = L.map('map', { zoomControl: false, minZoom: 1, maxZoom: 7, doubleClickZoom: false, zoomAnimation: false }).setView([-60, -20], 3);
	L.tileLayer('https://media.githubusercontent.com/media/LowS1312/inf-gangmap/main/tiles/atlas/{z}/{x}_{y}.png', {
		minZoom: 1,
		maxZoom: 7,
		maxNativeZoom: 7,
		attribution: '<a href="https://github.com/LowS1312/inf-gangmap" target="_blank" rel="noreferrer">Atlas PRODIGY</a>',
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
		if (supabaseClient) {
			const { data, error } = await supabaseClient.auth.getSession();
			if (!error && data.session) await verifyAdmin(data.session.user);
		}
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
elements.saveRegion.addEventListener('click', saveRegion);
document.querySelector('#panel-toggle').addEventListener('click', () => elements.sidebar.classList.toggle('is-open'));
elements.adminToggle.addEventListener('click', async () => {
	if (isAdmin) {
		await supabaseClient.auth.signOut();
		setAdminAccess(false);
		showToast('Sesión cerrada.');
		return;
	}
	elements.adminError.hidden = Boolean(supabaseClient);
	if (!supabaseClient) elements.adminError.textContent = 'Configura Supabase antes de habilitar el acceso admin.';
	elements.adminDialog.hidden = false;
	if (supabaseClient) elements.adminEmail.focus();
});
elements.adminForm.addEventListener('submit', async (event) => {
	event.preventDefault();
	if (!supabaseClient) {
		elements.adminError.textContent = 'Configura Supabase antes de habilitar el acceso admin.';
		elements.adminError.hidden = false;
		return;
	}
	const { data, error } = await supabaseClient.auth.signInWithPassword({
		email: elements.adminEmail.value.trim(),
		password: elements.adminPassword.value,
	});
	if (error) {
		elements.adminError.textContent = error.message;
		elements.adminError.hidden = false;
		return;
	}
	await verifyAdmin(data.user);
});
document.querySelector('#close-admin').addEventListener('click', () => { elements.adminDialog.hidden = true; });
document.querySelector('#cancel-admin').addEventListener('click', () => { elements.adminDialog.hidden = true; });
function closeExportDialog() {
	elements.exportDialog.hidden = true;
	elements.saveRegion.hidden = true;
	elements.regionNotes.value = '';
	elements.regionTitle.value = 'Nueva zona';
	editingRecord = null;
}

document.querySelector('#close-dialog').addEventListener('click', closeExportDialog);
document.querySelector('#close-export').addEventListener('click', closeExportDialog);
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
function updateRegionJson() {
	if (!elements.exportDialog.hidden) {
		try {
			const region = JSON.parse(elements.regionJson.value);
			region.title = elements.regionTitle.value.trim() || 'Nueva zona';
			region.notes = elements.regionNotes.value.trim();
			elements.regionJson.value = JSON.stringify(region, null, 2);
		} catch {
			return;
		}
	}
}
elements.regionTitle.addEventListener('input', updateRegionJson);
elements.regionNotes.addEventListener('input', updateRegionJson);
elements.exportDialog.addEventListener('click', (event) => {
	if (event.target === elements.exportDialog) closeExportDialog();
});
document.addEventListener('keydown', (event) => {
	if (event.key === 'Escape') {
		if (drawing) cancelDrawing();
		closeExportDialog();
		elements.adminDialog.hidden = true;
		elements.sidebar.classList.remove('is-open');
	}
});

if (window.L) initialize();