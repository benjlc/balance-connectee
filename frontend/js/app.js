const RUCHES_DATA = {};

const MAX_HISTORY_ENTRIES = 240;
const ACTIVE_RUCHE_SYNC_INTERVAL_MS = 5000;
const API_BASE_URL = String(window.COUESNON_API_BASE_URL || '').replace(/\/+$/, '');
const SELECTED_RUCHE_STORAGE_KEY = 'couesnon.selectedDeviceId';

let history       = {};
let leafletMap    = null;
let leafletMarker = null;
let userMarker    = null;
let activeKey     = null;
const loadedHistoryDevices = new Set();
const selectedHistoryIndexByKey = {};

/* ── DOM refs ──────────────────────────────────────────── */
const lastReception  = document.getElementById('last-reception');
const lastMeasure    = document.getElementById('last-measure');
const variationEl    = document.getElementById('variation');
const historySection = document.getElementById('history-section');
const historyList    = document.getElementById('history-list');
const historyCount   = document.getElementById('history-count');
const mapCard        = document.getElementById('map-card');
const distanceUserRuche = document.getElementById('distance-user-ruche');
const topbarName     = document.getElementById('topbar-name');
const topbarBadge    = document.getElementById('topbar-badge');
const topbarCoords   = document.getElementById('topbar-coords');
const topbarCoordsText = document.getElementById('topbar-coords-text');
const btnGraph = document.getElementById('btn-graph');
const btnBackGraph   = document.getElementById('btn-back');
const btnBackGestion = document.getElementById('btn-back-gestion');
const mainView  = document.getElementById('main-view');
const graphView = document.getElementById('graph-view');
const btngest = document.getElementById('btn-gestion');
const gestionView = document.getElementById('gestion-view');
const historyView = document.getElementById('history-view');
const btnBackHistory = document.getElementById('btn-back-history');
const historyFullPage = document.getElementById('history-full-page');
const btnHistoryFull = document.getElementById('btn-history-full');
const mobileMenuBtn = document.getElementById('mobile-menu-btn');
const sidebar = document.querySelector('.sidebar');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const btnUserPosition = document.getElementById('btn-user-position');
const mobileActionsBtn = document.getElementById('mobile-actions-btn');
const mainActionsRow = document.querySelector('#main-view .topbar .actions-row');
const navHome = document.getElementById('nav-home');
const navGraph = document.getElementById('nav-graph');
const navHistory = document.getElementById('nav-history');
const navGestion = document.getElementById('nav-gestion');
const mapToggle = document.getElementById('map-toggle');
const historyClose = document.getElementById('history-close');
const btnAddUser = document.getElementById('btn-add-user');
const usersList = document.getElementById('users-list');
const usersCount = document.getElementById('users-count');
const userModalOverlay = document.getElementById('user-modal-overlay');
const userModalTitle = document.getElementById('user-modal-title');
const userModalClose = document.getElementById('user-modal-close');
const userModalCancel = document.getElementById('user-modal-cancel');
const userModalSave = document.getElementById('user-modal-save');
const userEmailField = document.getElementById('user-email-field');
const userPasswordField = document.getElementById('user-password-field');
const userActiveField = document.getElementById('user-active-field');
const userEmailInput = document.getElementById('user-email');
const userPasswordInput = document.getElementById('user-password');
const userDisplayNameInput = document.getElementById('user-display-name');
const userRoleInput = document.getElementById('user-role');
const userActiveInput = document.getElementById('user-active');
let currentMapTarget = null;
let adminUsers = [];
let editingUserId = null;

mobileMenuBtn?.setAttribute('aria-label', 'Ouvrir le menu');
btnUserPosition?.setAttribute('aria-label', 'Centrer la carte sur ma position');

document.getElementById('footer-date').textContent = new Date().toLocaleDateString('fr-FR', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
});

function showToast(message, type = 'info') {
    let toast = document.querySelector('.toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.className = 'toast';
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');
        document.body.appendChild(toast);
    }

    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2600);
}

function getFocusableElements(container) {
    return [...container.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )].filter(el => !el.disabled && el.offsetParent !== null);
}

function closeAppDialog(dialog, result, cleanup) {
    if (cleanup.closed) return;
    cleanup.closed = true;
    cleanup.resolve(result);
    dialog.remove();

    if (cleanup.previousFocus?.isConnected) {
        cleanup.previousFocus.focus();
    }
}

function showAppDialog({
    title,
    message = '',
    type = 'info',
    confirmText = 'OK',
    cancelText = null,
    danger = false,
    prompt = null,
    cancelable = true
}) {
    return new Promise(resolve => {
        const previousFocus = document.activeElement;
        const titleId = `app-dialog-title-${Date.now()}`;
        const dialog = document.createElement('div');
        dialog.className = `modal-overlay app-dialog-overlay app-dialog-${type}`;
        dialog.innerHTML = `
            <div class="modal app-dialog" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
                <div class="modal-header">
                    <span class="modal-title" id="${titleId}">${escapeHtml(title)}</span>
                    ${cancelable ? '<button class="modal-close" type="button" data-dialog-action="cancel" aria-label="Fermer la fenetre">&times;</button>' : ''}
                </div>
                <div class="modal-body">
                    ${message ? `<div class="app-dialog-message">${escapeHtml(message)}</div>` : ''}
                    ${prompt ? `
                        <div class="modal-field">
                            <label for="app-dialog-input">${escapeHtml(prompt.label)}</label>
                            <input type="text" id="app-dialog-input" value="${escapeHtml(prompt.defaultValue || '')}" maxlength="${prompt.maxLength || 80}" />
                        </div>
                    ` : ''}
                </div>
                <div class="modal-footer">
                    ${cancelText ? `<button class="btn btn-ghost" type="button" data-dialog-action="cancel">${escapeHtml(cancelText)}</button>` : ''}
                    <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" type="button" data-dialog-action="confirm">${escapeHtml(confirmText)}</button>
                </div>
            </div>
        `;

        document.body.appendChild(dialog);

        const modal = dialog.querySelector('.app-dialog');
        const input = dialog.querySelector('#app-dialog-input');
        const confirmBtn = dialog.querySelector('[data-dialog-action="confirm"]');
        const cleanup = { resolve, previousFocus };

        const finish = value => closeAppDialog(dialog, value, cleanup);

        dialog.addEventListener('click', event => {
            if (event.target === dialog && cancelable) {
                finish(prompt ? null : false);
            }
        });

        dialog.addEventListener('click', event => {
            const action = event.target.closest('[data-dialog-action]')?.dataset.dialogAction;
            if (!action) return;

            if (action === 'cancel') {
                finish(prompt ? null : false);
                return;
            }

            if (prompt) {
                finish(input.value);
                return;
            }

            finish(true);
        });

        dialog.addEventListener('keydown', event => {
            if (event.key === 'Escape' && cancelable) {
                event.preventDefault();
                finish(prompt ? null : false);
                return;
            }

            if (event.key === 'Enter' && prompt) {
                event.preventDefault();
                finish(input.value);
                return;
            }

            if (event.key !== 'Tab') return;

            const focusable = getFocusableElements(modal);
            if (!focusable.length) return;

            const first = focusable[0];
            const last = focusable[focusable.length - 1];

            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        });

        setTimeout(() => {
            if (input) {
                input.focus();
                input.select();
                return;
            }

            confirmBtn.focus();
        }, 30);
    });
}

function showAppAlert({ title = 'Information', message = '', type = 'info' } = {}) {
    return showAppDialog({
        title,
        message,
        type,
        confirmText: 'OK',
        cancelable: true
    }).then(() => undefined);
}

function showAppConfirm({
    title = 'Confirmer',
    message = '',
    confirmText = 'Confirmer',
    cancelText = 'Annuler',
    danger = false
} = {}) {
    return showAppDialog({
        title,
        message,
        type: danger ? 'danger' : 'info',
        confirmText,
        cancelText,
        danger,
        cancelable: true
    });
}

function showAppPrompt({
    title = 'Saisie',
    label = 'Valeur',
    defaultValue = '',
    confirmText = 'Valider',
    cancelText = 'Annuler'
} = {}) {
    return showAppDialog({
        title,
        confirmText,
        cancelText,
        prompt: { label, defaultValue },
        cancelable: true
    });
}

function setBottomNavActive(id) {
    document.querySelectorAll('.bottom-nav-item').forEach(btn => {
        btn.classList.toggle('active', btn.id === id);
    });
}

function showView(viewName) {
    mainView.style.display = viewName === 'main' ? 'flex' : 'none';
    graphView.style.display = viewName === 'graph' ? 'flex' : 'none';
    historyView.style.display = viewName === 'history' ? 'flex' : 'none';
    gestionView.style.display = viewName === 'gestion' ? 'flex' : 'none';
    closeMobileActions();

    const bottomNavByView = {
        main: 'nav-home',
        graph: 'nav-graph',
        history: 'nav-history',
        gestion: 'nav-gestion'
    };

    if (bottomNavByView[viewName]) {
        setBottomNavActive(bottomNavByView[viewName]);
    }
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function parseCoordinateValue(value) {
    if (value === undefined || value === null || value === '') return null;

    const coordinate = Number(value);
    return Number.isFinite(coordinate) ? coordinate : null;
}

function setRucheActionAvailability(enabled) {
    [btnGraph, navGraph, navHistory, btnHistoryFull, btnUserPosition].forEach(button => {
        if (button) button.disabled = !enabled;
    });
}

function setMetricPlaceholders() {
    lastReception.textContent = '—';
    lastReception.className = 'mc-value';
    lastMeasure.textContent = '—';
    lastMeasure.className = 'mc-value';
    variationEl.textContent = '—';
    variationEl.className = 'mc-value';
}

function clearSelectedRuche(message = 'Aucune ruche enregistrée') {
    activeKey = null;
    localStorage.removeItem(SELECTED_RUCHE_STORAGE_KEY);

    document.querySelectorAll('.nav-item, .nav-ruche-row').forEach(el => {
        el.classList.remove('active');
    });

    topbarName.textContent = message;
    topbarBadge.style.display = 'none';
    topbarCoords.style.display = 'none';
    historySection.style.display = 'none';
    historyCount.textContent = '0';
    historyList.innerHTML = '';
    setMetricPlaceholders();
    clearMapState('', { hide: true });
    setRucheActionAvailability(false);
    refreshCurrentView();
}

function canManageRuches() {
    return AUTH.isRole('admin') || AUTH.isRole('dev');
}

function formatDistance(meters) {
    if (!Number.isFinite(meters)) return '—';
    if (meters < 1000) return `${Math.round(meters)} m`;
    return `${(meters / 1000).toFixed(2)} km`;
}

function buildMarkerAccessibleLabel(nom, lat, lng, measurement = null) {
    const coords = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

    if (!measurement) {
        return `${nom}, coordonnées ${coords}`;
    }

    return `${nom}, ${Number(measurement.poids).toFixed(2)} kilogrammes, ${measurement.time}, coordonnées ${coords}`;
}

function applyMarkerAccessibility(marker, label) {
    const markerEl = marker?.getElement?.();
    if (!markerEl) return;

    markerEl.setAttribute('aria-label', label);
    markerEl.setAttribute('title', label);
}

function updateDistanceInfo(lat = currentMapTarget?.lat, lng = currentMapTarget?.lng) {
    if (!distanceUserRuche) return;

    currentMapTarget = Number.isFinite(lat) && Number.isFinite(lng)
        ? { lat, lng }
        : null;

    if (!currentMapTarget || !userMarker || !leafletMap) {
        distanceUserRuche.textContent = 'Distance : —';
        return;
    }

    const userLatLng = userMarker.getLatLng();
    const distance = leafletMap.distance(
        [userLatLng.lat, userLatLng.lng],
        [currentMapTarget.lat, currentMapTarget.lng]
    );

    distanceUserRuche.textContent = `Distance : ${formatDistance(distance)}`;
}

function updateUserPosition({ centerOnUser = false } = {}) {
    if (!navigator.geolocation || !leafletMap) return;

    navigator.geolocation.getCurrentPosition(
        position => {
            const userLat = position.coords.latitude;
            const userLng = position.coords.longitude;

            if (userMarker) {
                leafletMap.removeLayer(userMarker);
            }

            userMarker = L.marker([userLat, userLng])
                .addTo(leafletMap)
                .bindPopup('Votre position');

            applyMarkerAccessibility(
                userMarker,
                `Votre position, coordonnées ${userLat.toFixed(5)}, ${userLng.toFixed(5)}`
            );

            updateDistanceInfo();

            if (centerOnUser) {
                leafletMap.setView([userLat, userLng], 16);
                userMarker.openPopup();
            }
        },
        err => {
            console.warn('Position refusee ou indisponible :', err);
            showToast('Position utilisateur indisponible');
        },
        {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 0
        }
    );
}

function initMap(lat, lng, nom, measurement = null) {
    mapCard.style.display = '';
    currentMapTarget = { lat, lng };
    document.getElementById('map-empty-state')?.remove();

    const honeyIcon = L.divIcon({
        className: '',
        html: `<svg width="34" height="42" viewBox="0 0 34 42" fill="none">
            <path d="M17 0C7.6 0 0 7.6 0 17c0 12.7 17 25 17 25S34 29.7 34 17C34 7.6 26.4 0 17 0z"
                fill="#F5A623" stroke="#C47C0A" stroke-width="1.5"/>
            <circle cx="17" cy="17" r="7.5" fill="white" fill-opacity="0.92"/>
            <text x="17" y="22" text-anchor="middle" font-size="10"
                font-family="DM Sans,sans-serif" font-weight="600" fill="#5C3A00">&#x1F41D;</text>
        </svg>`,
        iconSize: [34, 42],
        iconAnchor: [17, 42],
        popupAnchor: [0, -44]
    });

    if (!leafletMap) {
        leafletMap = L.map('ruche-map', { zoomControl: true, scrollWheelZoom: false })
            .setView([lat, lng], 16);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a>',
            maxZoom: 19
        }).addTo(leafletMap);
    } else {
        leafletMap.setView([lat, lng], 16);
        if (leafletMarker) leafletMap.removeLayer(leafletMarker);
    }

    const popupDetails = measurement
        ? `<br><span style="color:#5C3A00;font-size:.84rem">${Number(measurement.poids).toFixed(2)} kg</span>
           <br><span style="color:#5C3A00;font-size:.8rem">${escapeHtml(measurement.time)}</span>`
        : '';

    leafletMarker = L.marker([lat, lng], { icon: honeyIcon })
        .addTo(leafletMap)
        .bindPopup(`<strong>${escapeHtml(nom)}</strong>${popupDetails}<br><span style="color:#5C3A00;font-size:.8rem">${lat.toFixed(5)}, ${lng.toFixed(5)}</span>`)
        .openPopup();

    applyMarkerAccessibility(leafletMarker, buildMarkerAccessibleLabel(nom, lat, lng, measurement));

    updateDistanceInfo(lat, lng);
    setTimeout(() => leafletMap.invalidateSize(), 80);
}

function clearMapState(message = 'Position GPS indisponible', { hide = false } = {}) {
    currentMapTarget = null;

    if (leafletMap && leafletMarker) {
        leafletMap.removeLayer(leafletMarker);
        leafletMarker = null;
    }

    updateDistanceInfo(null, null);

    if (hide) {
        mapCard.style.display = 'none';
        document.getElementById('map-empty-state')?.remove();
        return;
    }

    mapCard.style.display = '';

    let emptyState = document.getElementById('map-empty-state');
    if (!emptyState) {
        emptyState = document.createElement('div');
        emptyState.id = 'map-empty-state';
        emptyState.className = 'map-empty-state';
        document.getElementById('ruche-map')?.appendChild(emptyState);
    }
    emptyState.textContent = message;
}

function trimHistoryForKey(key) {
    const entries = history[key];
    if (!entries || entries.length <= MAX_HISTORY_ENTRIES) return;

    const removedCount = entries.length - MAX_HISTORY_ENTRIES;
    entries.splice(0, removedCount);

    if (selectedHistoryIndexByKey[key] !== undefined) {
        selectedHistoryIndexByKey[key] = Math.max(0, selectedHistoryIndexByKey[key] - removedCount);
    }
}

function updateSelectedRucheMap(key) {
    const ruche = RUCHES_DATA[key];
    if (!ruche) return;

    const entries = history[key] || [];
    const latestEntryWithCoords = [...entries].reverse().find(hasValidCoordinates);
    const mapSource = latestEntryWithCoords || ruche;

    if (!hasValidCoordinates(mapSource)) {
        topbarCoords.style.display = 'none';
        clearMapState('Position GPS indisponible');
        return;
    }

    const lat = Number(mapSource.latitude ?? mapSource.lat);
    const lng = Number(mapSource.longitude ?? mapSource.lng);
    topbarCoordsText.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    topbarCoords.style.display = '';

    const measurement = latestEntryWithCoords
        ? {
            poids: latestEntryWithCoords.poids,
            time: formatMeasurementDateTime(getMeasurementTimeSource(latestEntryWithCoords))
        }
        : null;

    initMap(lat, lng, ruche.nom.join(' '), measurement);
}

function selectRuche(key) {
    if (!RUCHES_DATA[key]) {
        console.warn('[API] ruche inconnue:', key);
        return;
    }

    activeKey = key;
    localStorage.setItem(SELECTED_RUCHE_STORAGE_KEY, key);
    setRucheActionAvailability(true);

    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.key === key);
    });
    document.querySelectorAll('.nav-ruche-row').forEach(row => {
        row.classList.toggle('active', row.dataset.key === key);
    });

    const data = RUCHES_DATA[key];

    topbarName.textContent = data.nom.join(' ');
    topbarBadge.style.display = 'none';

    historySection.style.display = '';
    updateHistory(key);
    updateMetrics(key);
    updateSelectedRucheMap(key);
    loadSavedMeasurementsForRuche(key);

    refreshCurrentView();
}

document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => selectRuche(btn.dataset.key));
});

function updateMetrics(key) {
    const entries = history[key] || [];
    if (!entries.length) {
        setMetricPlaceholders();
        return;
    }
    const last = entries[entries.length - 1];
    const receptionSource = last._receivedAt || last.received_at || last._timestamp;

    lastReception.innerHTML = `
    ${formatMeasurementDate(receptionSource)}
    <div style="font-size:0.75rem; color:#3B2600; font-family:'DM Sans', sans-serif; margin-top:2px;">
        ${formatMeasurementTime(receptionSource)}
    </div>
    `;
    lastReception.className = 'mc-value';

    lastMeasure.innerHTML = `
    ${last.poids.toFixed(2)} kg
    <div style="font-size:0.75rem; color:#6B4A16; font-family:'DM Sans', sans-serif; margin-top:2px;">
        ${last.ts}
    </div>
    `;

    if (last.prev !== null) {
        const delta = last.poids - last.prev;
        const sign  = delta > 0 ? '+' : '';
        variationEl.textContent = `${sign}${delta.toFixed(2)} kg`;
        variationEl.className   = 'mc-value ' + (delta > 0 ? 'positive' : delta < 0 ? 'negative' : '');
    } else {
        variationEl.textContent = '—';
        variationEl.className   = 'mc-value';
    }
}

/* ── updateHistory ─────────────────────────────────────── */
function updateHistory(key) {
    const entries = history[key] || [];
    historyCount.textContent = entries.length;

    if (!entries.length) {
        historyList.innerHTML = `<li style="padding:.5rem .65rem;font-size:.82rem;color:var(--text-soft);">Aucune mesure enregistrée</li>`;
        return;
    }

    const selectedIndex = selectedHistoryIndexByKey[key];

    historyList.innerHTML = entries.map((entry, index) => ({ entry, index })).reverse().slice(0, 8).map(({ entry: e, index }) => {
        let deltaHtml = '<span class="hi-delta">—</span>';
        let deltaLabel = '';
        if (e.prev !== null) {
            const d    = e.poids - e.prev;
            const sign = d > 0 ? '+' : '';
            const cls  = d > 0 ? 'pos' : d < 0 ? 'neg' : 'neu';
            deltaHtml  = `<span class="hi-delta ${cls}">${sign}${d.toFixed(2)} kg</span>`;
            deltaLabel = `, variation ${sign}${d.toFixed(2)} kg`;
        }
        return `<li class="history-item ${selectedIndex === index ? 'selected' : ''}" data-history-index="${index}" tabindex="0" aria-label="${escapeHtml(`Mesure du ${e.ts}, ${e.poids.toFixed(2)} kg${deltaLabel}`)}">
            <span class="hi-time">${e.ts}</span>
            <span class="hi-value">${e.poids.toFixed(2)} kg</span>
            ${deltaHtml}
        </li>`;
    }).join('');
}

function isKeyboardActivation(event) {
    return event.key === 'Enter' || event.key === ' ';
}

function formatMeasurementTime(receivedAt) {
    const date = receivedAt ? new Date(receivedAt) : new Date();

    return date.toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: 'Europe/Paris'
    });
}

function formatMeasurementDate(receivedAt) {
    const date = receivedAt ? new Date(receivedAt) : new Date();

    return date.toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'Europe/Paris'
    });
}

function formatMeasurementDateTime(receivedAt) {
    const date = receivedAt ? new Date(receivedAt) : new Date();

    return date.toLocaleString('fr-FR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: 'Europe/Paris'
    });
}

function getMeasurementTimeSource(entry) {
    return entry?._receivedAt || entry?.received_at || entry?._timestamp || null;
}

function hasValidCoordinates(entry) {
    const lat = parseCoordinateValue(entry?.latitude ?? entry?.lat);
    const lng = parseCoordinateValue(entry?.longitude ?? entry?.lng);

    return lat !== null && lng !== null;
}

function updateMapForHistoryEntry(key, entry) {
    if (!RUCHES_DATA[key] || !hasValidCoordinates(entry)) return false;

    const lat = parseCoordinateValue(entry.latitude);
    const lng = parseCoordinateValue(entry.longitude);
    const time = formatMeasurementDateTime(getMeasurementTimeSource(entry));

    topbarCoordsText.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    initMap(lat, lng, RUCHES_DATA[key].nom.join(' '), {
        poids: entry.poids,
        time
    });

    return true;
}

function formatHistoryDetails(entry) {
    const lat = parseCoordinateValue(entry.latitude);
    const lng = parseCoordinateValue(entry.longitude);
    const coords = hasValidCoordinates(entry)
        ? `${lat.toFixed(5)}, ${lng.toFixed(5)}`
        : 'Coordonnées indisponibles';

    return [
        `Poids : ${entry.poids.toFixed(2)} kg`,
        `Réception : ${formatMeasurementDateTime(getMeasurementTimeSource(entry))}`,
        `GPS : ${coords}`
    ].join('\n');
}

function selectHistoryEntry(key, index, { updateMap = false } = {}) {
    const entries = history[key] || [];
    const entry = entries[index];

    if (!entry) return null;

    selectedHistoryIndexByKey[key] = index;
    updateHistory(key);

    if (updateMap && !updateMapForHistoryEntry(key, entry)) {
        showToast('Coordonnées indisponibles pour cette mesure');
    }

    return entry;
}

historyList.addEventListener('click', event => {
    const item = event.target.closest('.history-item[data-history-index]');
    if (!item || !activeKey) return;

    selectHistoryEntry(activeKey, Number(item.dataset.historyIndex), { updateMap: true });
});

historyList.addEventListener('keydown', event => {
    const item = event.target.closest('.history-item[data-history-index]');
    if (!item || !activeKey || !isKeyboardActivation(event)) return;

    event.preventDefault();
    selectHistoryEntry(activeKey, Number(item.dataset.historyIndex), { updateMap: true });
});

function splitRucheName(name, deviceId) {
    const label = (name || deviceId || 'Ruche').trim();
    const match = label.match(/^Ruche\s+(.+)$/i);

    if (match) return ['Ruche', match[1]];
    return [label];
}

function getRucheStateFromApi(ruche) {
    const key = typeof ruche?.device_id === 'string' ? ruche.device_id.trim() : '';
    if (!key) return null;

    const location = ruche.location || {};
    const lat = parseCoordinateValue(location.latitude);
    const lng = parseCoordinateValue(location.longitude);

    return {
        key,
        data: {
            id: ruche.id,
            device_id: key,
            location_id: ruche.location_id,
            nom: splitRucheName(ruche.name, ruche.device_id || key),
            lat,
            lng,
            latitude: lat,
            longitude: lng
        }
    };
}

function getNavItemByKey(key) {
    return [...document.querySelectorAll('.nav-item')]
        .find(btn => btn.dataset.key === key);
}

function getNavRowByKey(key) {
    return [...document.querySelectorAll('.nav-ruche-row')]
        .find(row => row.dataset.key === key);
}

function getNavItemMarkup(label) {
    return `
        <span class="nav-left">
            <span class="nav-dot"></span>
            <span class="nav-label">${escapeHtml(label)}</span>
        </span>
    `;
}

function bindNavRowActions(row, key) {
    row.querySelector('.nav-item')?.addEventListener('click', () => selectRuche(key));
    row.querySelector('.rename-ruche')?.addEventListener('click', event => {
        event.stopPropagation();
        renameRuche(key);
    });
    row.querySelector('.delete-ruche')?.addEventListener('click', event => {
        event.stopPropagation();
        deleteRuche(key);
    });
}

document.querySelectorAll('.nav-ruche-row').forEach(row => {
    bindNavRowActions(row, row.dataset.key);
});

function updateNavItemLabel(key, label) {
    const btn = getNavItemByKey(key);
    if (!btn) return;
    btn.innerHTML = getNavItemMarkup(label);
}

function measurementToHistoryEntry(measurement, previousEntry) {
    const receivedAt = measurement.received_at || measurement.created_at;
    const latitude = parseCoordinateValue(measurement.latitude);
    const longitude = parseCoordinateValue(measurement.longitude);

    return {
        poids: Number(measurement.poids),
        latitude,
        longitude,
        received_at: receivedAt,
        ts: formatMeasurementTime(receivedAt),
        prev: previousEntry ? previousEntry.poids : null,
        _timestamp: new Date(receivedAt),
        _receivedAt: receivedAt
    };
}

function getMeasurementIdentity(entryOrMeasurement) {
    return entryOrMeasurement?._receivedAt
        || entryOrMeasurement?.received_at
        || entryOrMeasurement?.created_at
        || null;
}

function mergeMeasurementsIntoHistory(key, measurements) {
    if (!Array.isArray(measurements) || !RUCHES_DATA[key]) return false;

    if (!history[key]) history[key] = [];

    const entries = history[key];
    const seen = new Set(entries.map(getMeasurementIdentity).filter(Boolean));
    let changed = false;

    for (const measurement of measurements) {
        const identity = getMeasurementIdentity(measurement);
        if (identity && seen.has(identity)) continue;

        const previousEntry = entries[entries.length - 1] || null;
        entries.push(measurementToHistoryEntry(measurement, previousEntry));
        if (identity) seen.add(identity);
        changed = true;
    }

    if (!changed) return false;

    trimHistoryForKey(key);

    const latestMeasurement = measurements[measurements.length - 1] || null;
    setRuchePositionFromMeasurement(key, latestMeasurement);

    if (activeKey === key) {
        updateHistory(key);
        updateMetrics(key);
        updateSelectedRucheMap(key);

        if (graphView.style.display !== 'none') {
            renderGraph();
        }

        if (historyView.style.display !== 'none') {
            openFullHistory();
        }
    }

    return true;
}

function setRuchePositionFromMeasurement(key, measurement) {
    if (!measurement || !RUCHES_DATA[key]) return;

    const lat = parseCoordinateValue(measurement.latitude);
    const lng = parseCoordinateValue(measurement.longitude);

    if (lat !== null) {
        RUCHES_DATA[key].lat = lat;
        RUCHES_DATA[key].latitude = lat;
    }

    if (lng !== null) {
        RUCHES_DATA[key].lng = lng;
        RUCHES_DATA[key].longitude = lng;
    }
}

function getApiUrl(url) {
    if (/^https?:\/\//i.test(url)) return url;

    const path = url.startsWith('/') ? url : `/${url}`;
    return `${API_BASE_URL}${path}`;
}

function apiFetch(url, options = {}) {
    return fetch(getApiUrl(url), options);
}

async function fetchJson(url, options = {}) {
    const headers = {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
    };

    const response = await apiFetch(url, {
        ...options,
        headers
    });

    if (!response.ok) {
        let message = `${url} returned ${response.status}`;

        try {
            const body = await response.json();
            if (body?.error) message = body.error;
        } catch {
            // Keep the HTTP status message when the server returns non-JSON.
        }

        throw new Error(message);
    }

    if (response.status === 204) return null;

    return response.json();
}

async function fetchAdminJson(url, options = {}) {
    const token = await AUTH.getAccessToken?.();

    if (!token) {
        throw new Error('Session Supabase introuvable');
    }

    return fetchJson(url, {
        ...options,
        headers: {
            Authorization: `Bearer ${token}`,
            ...(options.headers || {})
        }
    });
}

async function loadSavedMeasurementsForRuche(key) {
    const ruche = RUCHES_DATA[key];
    if (!ruche || !ruche.device_id || loadedHistoryDevices.has(ruche.device_id)) return;

    try {
        const measurements = await fetchJson(`/api/ruches/${encodeURIComponent(ruche.device_id)}/measurements`);

        history[key] = history[key] || [];
        mergeMeasurementsIntoHistory(key, measurements || []);
        loadedHistoryDevices.add(ruche.device_id);

        const latest = Array.isArray(measurements) ? measurements[measurements.length - 1] || null : null;
        setRuchePositionFromMeasurement(key, latest);

        if (activeKey === key) {
            updateHistory(key);
            updateMetrics(key);
            updateSelectedRucheMap(key);
            refreshCurrentView();
        }

    } catch (err) {
        console.error('[API] erreur chargement mesures:', err);
    }
}

async function syncMeasurementsForRuche(key) {
    const ruche = RUCHES_DATA[key];
    if (!ruche?.device_id) return;

    try {
        const measurements = await fetchJson(`/api/ruches/${encodeURIComponent(ruche.device_id)}/measurements`);
        mergeMeasurementsIntoHistory(key, measurements || []);
    } catch (err) {
        console.error('[API] erreur sync mesures:', err);
    }
}

function resetSidebar() {
    const nav = document.getElementById('sidebar-nav');
    nav.innerHTML = '';
}

async function loadSavedRuches() {
    try {
        const ruches = await fetchJson('/api/ruches');

        resetSidebar();
        Object.keys(RUCHES_DATA).forEach(key => delete RUCHES_DATA[key]);
        history = {};
        loadedHistoryDevices.clear();
        Object.keys(selectedHistoryIndexByKey).forEach(key => delete selectedHistoryIndexByKey[key]);

        (Array.isArray(ruches) ? ruches : []).forEach(ruche => {
            const state = getRucheStateFromApi(ruche);
            if (!state) {
                console.warn('[API] ruche ignoree sans device_id:', ruche);
                return;
            }

            const { key, data } = state;

            RUCHES_DATA[key] = data;
            addNavItem(key, data.nom.join(' '));
        });

        const keys = Object.keys(RUCHES_DATA);

        if (!keys.length) {
            clearSelectedRuche('Aucune ruche enregistrée');
            console.log('[API] selected device_id: null');
            return;
        }

        const previousKey = activeKey || localStorage.getItem(SELECTED_RUCHE_STORAGE_KEY);
        const selectedKey = previousKey && RUCHES_DATA[previousKey] ? previousKey : keys[0];

        selectRuche(selectedKey);
        console.log(`[API] selected device_id: ${selectedKey}`);
    } catch (err) {
        console.error('[API] erreur chargement ruches:', err);
        resetSidebar();
        Object.keys(RUCHES_DATA).forEach(key => delete RUCHES_DATA[key]);
        history = {};
        loadedHistoryDevices.clear();
        clearSelectedRuche('Impossible de charger les ruches');
    }
}

function getNextUpdateDelay() {
    const now        = new Date();
    const intervalMs = 6 * 3600 * 1000;
    const midnight   = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    const elapsed     = now - midnight;
    const slotsPassed = Math.floor(elapsed / intervalMs);
    return new Date(midnight.getTime() + (slotsPassed + 1) * intervalMs) - now;
}

function updateCountdown() {
    const intervalMs   = 6 * 3600 * 1000;
    let remaining      = getNextUpdateDelay();
    if (remaining < 0) remaining = 0;

    const totalSeconds = Math.floor(remaining / 1000);
    const pad = n => String(n).padStart(2, '0');

    document.getElementById('hours').textContent   = pad(Math.floor(totalSeconds / 3600));
    document.getElementById('minutes').textContent = pad(Math.floor((totalSeconds % 3600) / 60));
    document.getElementById('seconds').textContent = pad(totalSeconds % 60);

    const barFill = document.getElementById('cd-bar-fill');
    if (barFill) {
        const pct = Math.min(100, Math.round(((intervalMs - remaining) / intervalMs) * 100));
        barFill.style.width = pct + '%';
    }

    const fmt      = d => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const now      = new Date();
    const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
    const slots    = Math.floor((now - midnight) / intervalMs);
    const lastUpd  = new Date(midnight.getTime() + slots * intervalMs);
    const nextUpd  = new Date(midnight.getTime() + (slots + 1) * intervalMs);

    const cdLast = document.getElementById('cd-last');
    const cdNext = document.getElementById('cd-next');
    if (cdLast) cdLast.textContent = 'Dernière : ' + fmt(lastUpd);
    if (cdNext) cdNext.textContent = 'Prochaine : ' + fmt(nextUpd);
}

updateCountdown();
setInterval(updateCountdown, 1000);

loadSavedRuches();
setInterval(() => {
    if (!activeKey) return;
    syncMeasurementsForRuche(activeKey);
}, ACTIVE_RUCHE_SYNC_INTERVAL_MS);

async function renameRuche(key = activeKey) {
    if (!key) {
        showToast("Sélectionne d'abord une ruche");
        return;
    }

    if (!canManageRuches()) {
        showToast('â›” Action non autorisÃ©e');
        return;
    }

    const data = RUCHES_DATA[key];
    if (!data?.id) {
        console.error('[API] impossible de renommer une ruche sans id Supabase:', key);
        showToast("Ruche non synchronisée avec Supabase");
        return;
    }

    const nouveauNumero = await showAppPrompt({
        title: 'Renommer la ruche',
        label: 'Nouveau numero de la ruche',
        defaultValue: data.nom.length > 1 ? data.nom[1] : data.nom.join(' '),
        confirmText: 'Renommer',
        cancelText: 'Annuler'
    });

    if (!nouveauNumero || !nouveauNumero.trim()) return;

    const name = nouveauNumero.trim();
    const keyToRename = key;

    try {
        console.log(`[API] renommage ruche ${data.id}: ${name}`);

        const updated = await fetchJson(`/api/ruches/${encodeURIComponent(data.id)}`, {
            method: 'PATCH',
            body: JSON.stringify({ name })
        });

        const updatedState = getRucheStateFromApi(updated);
        if (!updatedState || updatedState.key !== keyToRename) {
            throw new Error('device_id missing from updated ruche');
        }

        const { data: updatedData } = updatedState;
        RUCHES_DATA[keyToRename] = {
            ...data,
            ...updatedData,
            device_id: data.device_id
        };

        updateNavItemLabel(keyToRename, RUCHES_DATA[keyToRename].nom.join(' '));
        if (activeKey === keyToRename) {
            selectRuche(keyToRename);
        }

        console.log(`[API] ruche renommée: ${key}`);
        showToast("Numéro mis à jour ✅");
    } catch (err) {
        console.error('[API] erreur renommage ruche:', err);
        showToast("Erreur lors du renommage");
    }
}

function parseTrame(buffer, receivedAt) {
    if (!buffer || buffer.length < 12) {
        throw new Error(`Trame LoRa invalide : 12 octets attendus, ${buffer ? buffer.length : 0} reçu(s)`);
    }

    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

    const date = receivedAt ? new Date(receivedAt) : new Date();

    return {
        lat: view.getFloat32(0, true),
        lng: view.getFloat32(4, true),
        poids: view.getFloat32(8, true),
        time: date.toLocaleTimeString('fr-FR', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            timeZone: 'Europe/Paris'
        })
    };
}

function onTrameReceived(buffer, receivedAt, deviceId) {
    const data = parseTrame(buffer, receivedAt);   

    const key = deviceId && RUCHES_DATA[deviceId] ? deviceId : null;

    if (!key || !RUCHES_DATA[key]) {
        console.warn('[TTN] aucune ruche côté UI pour device_id:', deviceId);
        return;
    }

    if (!activeKey) selectRuche(key);

    RUCHES_DATA[key].lat = data.lat;
    RUCHES_DATA[key].lng = data.lng;
    RUCHES_DATA[key].latitude = data.lat;
    RUCHES_DATA[key].longitude = data.lng;

    if (activeKey === key) {
        topbarCoordsText.textContent = `${data.lat.toFixed(5)}, ${data.lng.toFixed(5)}`;
        topbarCoords.style.display = '';

        // ── Mise à jour carte ─────────────────────
        initMap(data.lat, data.lng, RUCHES_DATA[key].nom.join(' '), {
            poids: data.poids,
            time: formatMeasurementDateTime(receivedAt)
        });
    }

    if (!history[key]) history[key] = [];

    const last = history[key][history[key].length - 1];
    if (last && receivedAt && last._receivedAt === receivedAt) return;

    history[key].push({
        poids: data.poids,
        latitude: data.lat,
        longitude: data.lng,
        received_at: receivedAt || null,
        ts: data.time,
        prev: last ? last.poids : null,
        _timestamp: receivedAt ? new Date(receivedAt) : new Date(),
        _receivedAt: receivedAt || null
    });
    trimHistoryForKey(key);

    if (activeKey === key) {
        updateHistory(key);
        updateMetrics(key);

        if (graphView.style.display !== 'none') {
            renderGraph();
        }

        if (historyView.style.display !== 'none') {
            openFullHistory();
        }
    }

    showToast("📡 Nouvelle donnée reçue");
}

function encodeTrame({ lat, lng, poids, h, m, s }) {
    const buffer = new Uint8Array(115);
    const view = new DataView(buffer.buffer);

    view.setFloat32(0, lat, true);
    view.setFloat32(4, lng, true);
    view.setFloat32(8, poids, true);

    buffer[12] = h;
    buffer[13] = m;
    buffer[14] = s;

    return buffer;
}

btnGraph.addEventListener('click', () => {
    showView('graph');

    const titleEl = document.getElementById('graph-title');
    if (titleEl && activeKey) {
        titleEl.textContent = 'Graphique — ' + RUCHES_DATA[activeKey].nom.join(' ');
    } else if (titleEl) {
        titleEl.textContent = 'Graphique';
    }

    renderGraph();
});

btnBackGraph.addEventListener('click', () => {
    showView('main');
});

btnBackGestion.addEventListener('click', () => {
    showView('main');
});

let chart = null;

function renderGraph() {
    const ctx = document.getElementById('graphCanvas');
    const data = activeKey ? history[activeKey] || [] : [];

    if (chart) {
        chart.destroy();
        chart = null;
    }

    if (data.length === 0) {
        ctx.style.display = 'none';
        let msg = document.getElementById('graph-no-data');
        if (!msg) {
            msg = document.createElement('div');
            msg.id = 'graph-no-data';
            msg.style.cssText = 'text-align:center;padding:3rem;color:#9A7340;font-size:0.95rem;';
            ctx.parentNode.appendChild(msg);
        }
        msg.textContent = 'Aucune mesure disponible pour le graphique';
        return;
    }

    // Retire le message d'attente si présent
    const msg = document.getElementById('graph-no-data');
    if (msg) msg.remove();
    ctx.style.display = '';

    const MAX_POINTS = 20;

    const displayedData = data.slice(-MAX_POINTS);

    const labels = displayedData.map(e => e.ts);
    const values = displayedData.map(e => e.poids);

    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Poids (kg)',
                data: values,
                tension: 0.4,
                borderColor: '#F5A623',
                backgroundColor: 'rgba(245,166,35,0.12)',
                pointBackgroundColor: '#C47C0A',
                pointRadius: 5,
                pointHoverRadius: 7,
                fill: true,
                borderWidth: 2.5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 400 },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: ctx => ` ${ctx.parsed.y.toFixed(2)} kg`
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(196,124,10,0.08)' },
                    ticks: { color: '#9A7340', font: { family: 'DM Sans' } }
                },
                y: {
                    grid: { color: 'rgba(196,124,10,0.08)' },
                    ticks: { color: '#9A7340', font: { family: 'DM Sans' }, callback: v => v.toFixed(2) + ' kg' }
                }
            }
        }
    });
}

function base64ToUint8Array(base64) {
    const binary = atob(base64);
    const buffer = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
        buffer[i] = binary.charCodeAt(i);
    }

    return buffer;
}

function connectTTNStream() {
    const source = new EventSource(getApiUrl('/ttn-events'));

    source.onopen = () => {
        console.log('[TTN] connecté au flux uplink');
    };

    source.onmessage = event => {
        try {
            const msg = JSON.parse(event.data);

            if (!msg.frm_payload) return;

            const trame = base64ToUint8Array(msg.frm_payload);
            onTrameReceived(trame, msg.received_at, msg.device_id);
        } catch (err) {
            console.error('[TTN] erreur décodage uplink:', err);
        }
    };

    source.onerror = () => {
        console.warn('[TTN] flux déconnecté, reconnexion automatique...');
    };
}

connectTTNStream();

const modalOverlay  = document.getElementById('modal-overlay');
const btnAddRuche   = document.getElementById('btn-add-ruche');
const modalClose    = document.getElementById('modal-close');
const modalCancel   = document.getElementById('modal-cancel');
const modalConfirm  = document.getElementById('modal-confirm');
const inputNom      = document.getElementById('input-nom');
const inputDeviceId = document.getElementById('input-device-id');
const inputLat      = document.getElementById('input-lat');
const inputLng      = document.getElementById('input-lng');

modalClose?.setAttribute('aria-label', "Fermer la fenêtre d'ajout de ruche");
historyClose?.setAttribute('aria-label', "Fermer l'historique complet");
inputNom?.setAttribute('aria-label', 'Numéro ou nom de la ruche');
inputDeviceId?.setAttribute('aria-label', 'TTN device_id de la ruche');
inputLat?.setAttribute('aria-label', 'Latitude');
inputLng?.setAttribute('aria-label', 'Longitude');
 
function openModal() {
    inputNom.value = '';
    inputDeviceId.value = '';
    inputLat.value = '';
    inputLng.value = '';
    modalOverlay.style.display = 'flex';
    setTimeout(() => inputNom.focus(), 80);
}
 
function closeModal() {
    modalOverlay.style.display = 'none';
}
 
btnAddRuche.addEventListener('click', () => {
    closeSidebar();
    openModal();
});
modalClose.addEventListener('click', closeModal);
modalCancel.addEventListener('click', closeModal);
 
// Fermer en cliquant sur l'overlay
modalOverlay.addEventListener('click', e => {
    if (e.target === modalOverlay) closeModal();
});
 
// Fermer avec Échap
document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modalOverlay.style.display !== 'none') closeModal();
});
 
function validateModal() {
    const errors = [];
 
    const nom = inputNom.value.trim();
    if (!nom) errors.push('Le nom est requis');

    const deviceId = inputDeviceId.value.trim();
    if (!deviceId) errors.push('Le TTN device_id est requis');
 
    const lat = parseFloat(inputLat.value);
    const lng = parseFloat(inputLng.value);
    if (isNaN(lat) || lat < -90  || lat > 90)  errors.push('Latitude invalide (−90 à +90)');
    if (isNaN(lng) || lng < -180 || lng > 180) errors.push('Longitude invalide (−180 à +180)');
 
    return errors;
}
 
modalConfirm.addEventListener('click', async () => {
    const errors = validateModal();
    if (errors.length) {
        showToast(errors[0]);
        return;
    }
 
    const nom    = inputNom.value.trim();
    const deviceId = inputDeviceId.value.trim();
    const lat    = parseFloat(inputLat.value);
    const lng    = parseFloat(inputLng.value);
    const name = nom;

    modalConfirm.disabled = true;

    try {
        console.log(`[API] creation ruche ${deviceId}: ${name}`);

        const created = await fetchJson('/api/ruches', {
            method: 'POST',
            body: JSON.stringify({
                name,
                device_id: deviceId,
                latitude: lat,
                longitude: lng
            })
        });

        const state = getRucheStateFromApi(created);
        if (!state) {
            throw new Error('device_id missing from created ruche');
        }

        const { key, data } = state;

        RUCHES_DATA[key] = data;
        history[key] = [];

        addNavItem(key, data.nom.join(' '));

        closeModal();
        showToast(`${nom} ajoutée ✅`);

        console.log(`[API] ruche ajoutee: ${key}`, created);
        selectRuche(key);
    } catch (err) {
        console.error('[API] erreur ajout ruche:', err);
        showToast("Erreur lors de l'ajout de la ruche");
    } finally {
        modalConfirm.disabled = false;
    }
});
 
function addNavItem(key, label) {
    const nav = document.getElementById('sidebar-nav');
    const row = document.createElement('div');
    row.className = 'nav-ruche-row';
    row.dataset.key = key;
    row.innerHTML = `
        <button class="nav-item" data-key="${escapeHtml(key)}" type="button">
            ${getNavItemMarkup(label)}
        </button>
        ${canManageRuches() ? `
            <div class="nav-actions">
                <button class="nav-action rename-ruche" data-key="${escapeHtml(key)}" type="button" aria-label="Renommer la ruche">✏️</button>
                <button class="nav-action delete-ruche" data-key="${escapeHtml(key)}" type="button" aria-label="Supprimer la ruche">🗑️</button>
            </div>
        ` : ''}
    `;
    bindNavRowActions(row, key);
    nav.appendChild(row);
}

/* --Gestion Administrateur -------*/

const ADMIN_ROLE_META = {
    user: { label: 'Apiculteur', icon: '🐝', className: 'role-user' },
    admin: { label: 'Administrateur', icon: '👑', className: 'role-admin' },
    dev: { label: 'Developpeur', icon: '⚙️', className: 'role-dev' }
};

function getUserInitial(user) {
    const source = user?.display_name || user?.email || '?';
    return source.trim().charAt(0).toUpperCase() || '?';
}

function getUserRoleMeta(user) {
    if (user?.is_active === false) {
        const base = ADMIN_ROLE_META[user.role] || ADMIN_ROLE_META.user;
        return {
            ...base,
            label: `${base.label} - inactif`,
            className: 'role-inactive'
        };
    }

    return ADMIN_ROLE_META[user?.role] || ADMIN_ROLE_META.user;
}

function renderAdminUsers() {
    if (!usersList || !usersCount) return;

    usersCount.textContent = String(adminUsers.length);

    if (!adminUsers.length) {
        usersList.innerHTML = '<div class="user-empty">Aucun utilisateur</div>';
        return;
    }

    usersList.innerHTML = adminUsers.map(user => {
        const role = getUserRoleMeta(user);
        const name = user.display_name || user.email || 'Utilisateur';
        const email = user.email || 'Email indisponible';

        return `
            <div class="user-card ${user.is_active === false ? 'is-inactive' : ''}">
                <div class="user-left">
                    <div class="user-avatar" aria-hidden="true">${escapeHtml(getUserInitial(user))}</div>
                    <div>
                        <div class="user-name">${escapeHtml(name)}</div>
                        <div class="user-role ${role.className}">
                            ${role.icon} ${escapeHtml(role.label)}
                        </div>
                        <div class="user-meta">${escapeHtml(email)}</div>
                    </div>
                </div>
                <div class="user-actions">
                    <button class="btn btn-ghost" type="button" data-user-action="edit" data-user-id="${escapeHtml(user.id)}" aria-label="Modifier ${escapeHtml(name)}">
                        Modifier
                    </button>
                    <button class="btn btn-danger" type="button" data-user-action="delete" data-user-id="${escapeHtml(user.id)}" aria-label="Desactiver ${escapeHtml(name)}" ${user.is_active === false ? 'disabled' : ''}>
                        Supprimer
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

async function loadAdminUsers() {
    if (!canManageRuches() || !usersList) return;

    usersList.innerHTML = '<div class="user-empty">Chargement des utilisateurs...</div>';

    try {
        adminUsers = await fetchAdminJson('/api/admin/users');
        renderAdminUsers();
    } catch (err) {
        console.error('[API] erreur chargement utilisateurs:', err);
        usersList.innerHTML = '<div class="user-empty">Impossible de charger les utilisateurs</div>';
        usersCount.textContent = '0';
        showToast('Erreur lors du chargement des utilisateurs');
    }
}

function openUserModal(user = null) {
    editingUserId = user?.id || null;
    const isEditing = Boolean(editingUserId);

    userModalTitle.textContent = isEditing ? 'Modifier utilisateur' : 'Ajouter un utilisateur';
    userEmailField.style.display = isEditing ? 'none' : '';
    userPasswordField.style.display = isEditing ? 'none' : '';
    userActiveField.style.display = isEditing ? 'flex' : 'none';

    userEmailInput.value = isEditing ? '' : '';
    userPasswordInput.value = '';
    userDisplayNameInput.value = user?.display_name || '';
    userRoleInput.value = user?.role || 'user';
    userActiveInput.checked = user?.is_active !== false;

    userModalOverlay.style.display = 'flex';
    setTimeout(() => (isEditing ? userDisplayNameInput : userEmailInput).focus(), 80);
}

function closeUserModal() {
    userModalOverlay.style.display = 'none';
    editingUserId = null;
}

function getUserFormPayload() {
    const displayName = userDisplayNameInput.value.trim();
    const role = userRoleInput.value;

    if (!displayName) {
        return { error: 'Le nom affiche est requis' };
    }

    const payload = {
        display_name: displayName,
        role
    };

    if (editingUserId) {
        payload.is_active = userActiveInput.checked;
        return { payload };
    }

    const email = userEmailInput.value.trim();
    const password = userPasswordInput.value.trim();

    if (!email) {
        return { error: "L'email est requis" };
    }

    if (password.length < 6) {
        return { error: 'Le mot de passe doit contenir au moins 6 caracteres' };
    }

    return {
        payload: {
            ...payload,
            email,
            password
        }
    };
}

async function saveUserModal() {
    const { payload, error } = getUserFormPayload();

    if (error) {
        showToast(error);
        return;
    }

    userModalSave.disabled = true;

    try {
        if (editingUserId) {
            await fetchAdminJson(`/api/admin/users/${encodeURIComponent(editingUserId)}`, {
                method: 'PATCH',
                body: JSON.stringify(payload)
            });
            showToast('Utilisateur mis a jour');
        } else {
            await fetchAdminJson('/api/admin/users', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            showToast('Utilisateur ajoute');
        }

        closeUserModal();
        await loadAdminUsers();
    } catch (err) {
        console.error('[API] erreur sauvegarde utilisateur:', err);
        showToast(err.message || "Erreur lors de l'enregistrement");
    } finally {
        userModalSave.disabled = false;
    }
}

async function deactivateAdminUser(userId) {
    const user = adminUsers.find(item => item.id === userId);
    const name = user?.display_name || user?.email || 'cet utilisateur';

    const ok = await showAppConfirm({
        title: 'Desactiver un utilisateur',
        message: `Desactiver ${name} ?`,
        confirmText: 'Desactiver',
        cancelText: 'Annuler',
        danger: true
    });

    if (!ok) return;

    try {
        await fetchAdminJson(`/api/admin/users/${encodeURIComponent(userId)}`, {
            method: 'DELETE'
        });
        showToast('Utilisateur desactive');
        await loadAdminUsers();
    } catch (err) {
        console.error('[API] erreur desactivation utilisateur:', err);
        showToast(err.message || 'Erreur lors de la desactivation');
    }
}

btngest.addEventListener('click', () => {
    if (!canManageRuches()) {
        showToast('Action non autorisee');
        return;
    }

    showView('gestion');
    loadAdminUsers();
});

btnAddUser?.addEventListener('click', () => openUserModal());
userModalClose?.addEventListener('click', closeUserModal);
userModalCancel?.addEventListener('click', closeUserModal);
userModalSave?.addEventListener('click', saveUserModal);

userModalOverlay?.addEventListener('click', event => {
    if (event.target === userModalOverlay) closeUserModal();
});

usersList?.addEventListener('click', event => {
    const button = event.target.closest('[data-user-action][data-user-id]');
    if (!button) return;

    const user = adminUsers.find(item => item.id === button.dataset.userId);
    if (!user) return;

    if (button.dataset.userAction === 'edit') {
        openUserModal(user);
        return;
    }

    if (button.dataset.userAction === 'delete') {
        deactivateAdminUser(user.id);
    }
});

document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && userModalOverlay?.style.display !== 'none') {
        closeUserModal();
    }
});

/* ── Supprimer une ruche (admin / dev uniquement) ───── */
async function deleteRuche(key = activeKey) {
        // Vérification côté JS en plus du masquage HTML
        if (!canManageRuches()) {
            showToast('⛔ Action non autorisée');
            return;
        }

        if (!key) {
            showToast("Sélectionne d'abord une ruche");
            return;
        }

        const deletingKey = key;
        const ruche = RUCHES_DATA[deletingKey];
        const nomRuche = ruche?.nom.join(' ') || deletingKey;

        if (!ruche?.id) {
            console.error('[API] impossible de supprimer une ruche sans id Supabase:', deletingKey);
            showToast("Ruche non synchronisée avec Supabase");
            return;
        }

        // Empêcher la suppression de la dernière ruche
        if (Object.keys(RUCHES_DATA).length <= 1) {
            showToast('⚠️ Impossible de supprimer la dernière ruche');
            return;
        }

        const ok = await showAppConfirm({
            title: 'Supprimer une ruche',
            message: `Supprimer definitivement « ${nomRuche} » ?\nCette action est irreversible.`,
            confirmText: 'Supprimer',
            cancelText: 'Annuler',
            danger: true
        });
        if (!ok) return;

        try {
            console.log(`[API] suppression ruche ${ruche.id}: ${nomRuche}`);

            await fetchJson(`/api/ruches/${encodeURIComponent(ruche.id)}`, {
                method: 'DELETE'
            });

            // Supprimer les données
            delete RUCHES_DATA[deletingKey];
            delete history[deletingKey];
            loadedHistoryDevices.delete(ruche.device_id);

            // Supprimer le bouton de la sidebar
            const navRow = getNavRowByKey(deletingKey);
            if (navRow) navRow.remove();

            // Réinitialiser la vue
            activeKey = null;
            topbarName.textContent       = 'Sélectionnez une ruche';
            topbarBadge.style.display    = 'none';
            topbarCoords.style.display   = 'none';
            historySection.style.display = 'none';
            mapCard.style.display        = 'none';

            showToast(`🗑️ ${nomRuche} supprimée`);
            console.log(`[API] ruche supprimée: ${deletingKey}`);

            // Sélectionner automatiquement la première ruche restante
            const remaining = Object.keys(RUCHES_DATA);
            if (remaining.length > 0) selectRuche(remaining[0]);
        } catch (err) {
            console.error('[API] erreur suppression ruche:', err);
            showToast("Erreur lors de la suppression");
        }
}

function openFullHistory() {
    if (!activeKey) return;

    const entries = history[activeKey] || [];

    // switch de vue
    showView('history');

    const title = document.getElementById('history-title');
    title.textContent = 'Historique — ' + RUCHES_DATA[activeKey].nom.join(' ');

    const selectedIndex = selectedHistoryIndexByKey[activeKey];

    const historyHeader = `
        <div class="history-full-header">
            <span>Heure</span>
            <span>Poids</span>
            <span>Variation</span>
        </div>
    `;

    historyFullPage.innerHTML = entries.length
        ? historyHeader + entries.map((entry, index) => ({ entry, index })).reverse().map(({ entry, index }) => {
            let delta = '—';
            let deltaLabel = '';

            if (entry.prev !== null) {
                const d = entry.poids - entry.prev;
                const sign = d > 0 ? '+' : '';
                delta = `${sign}${d.toFixed(2)} kg`;
                deltaLabel = `, variation ${delta}`;
            }

            return `
                <div class="history-full-item ${selectedIndex === index ? 'selected' : ''}" data-history-index="${index}" tabindex="0" role="button" aria-label="${escapeHtml(`Mesure du ${entry.ts}, ${entry.poids.toFixed(2)} kg${deltaLabel}`)}">
                    <span>${entry.ts}</span>
                    <strong>${entry.poids.toFixed(2)} kg</strong>
                    <span>${delta}</span>
                </div>
            `;
        }).join('')
        : `<div style="color:var(--text-soft)">Aucune donnée</div>`;
}

btnHistoryFull.addEventListener('click', openFullHistory);

historyFullPage.addEventListener('click', async event => {
    const item = event.target.closest('.history-full-item[data-history-index]');
    if (!item || !activeKey) return;

    const entry = selectHistoryEntry(activeKey, Number(item.dataset.historyIndex));
    if (!entry) return;

    openFullHistory();
    await showAppAlert({
        title: 'Detail de la mesure',
        message: formatHistoryDetails(entry)
    });
});

historyFullPage.addEventListener('keydown', async event => {
    const item = event.target.closest('.history-full-item[data-history-index]');
    if (!item || !activeKey || !isKeyboardActivation(event)) return;

    event.preventDefault();

    const entry = selectHistoryEntry(activeKey, Number(item.dataset.historyIndex));
    if (!entry) return;

    openFullHistory();
    await showAppAlert({
        title: 'Detail de la mesure',
        message: formatHistoryDetails(entry)
    });
});

btnBackHistory.addEventListener('click', () => {
    showView('main');

    const selectedIndex = selectedHistoryIndexByKey[activeKey];
    if (selectedIndex !== undefined) {
        selectHistoryEntry(activeKey, selectedIndex, { updateMap: true });
    }
});

function refreshCurrentView() {
    if (graphView.style.display !== 'none') {
        const titleEl = document.getElementById('graph-title');
        titleEl.textContent = activeKey && RUCHES_DATA[activeKey]
            ? 'Graphique — ' + RUCHES_DATA[activeKey].nom.join(' ')
            : 'Graphique';
        renderGraph();
    }

    if (historyView.style.display !== 'none' && activeKey) {
        openFullHistory();
    }
}

function openSidebar() {
    sidebar.classList.add('open');
    sidebarOverlay.classList.add('show');
}

function closeSidebar() {
    sidebar.classList.remove('open');
    sidebarOverlay.classList.remove('show');
}

function closeMobileActions() {
    mainActionsRow?.classList.remove('open');
}

mobileMenuBtn?.addEventListener('click', openSidebar);
sidebarOverlay?.addEventListener('click', closeSidebar);

document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
        if (window.innerWidth <= 700) {
            closeSidebar();
        }
    });
});

mobileActionsBtn?.addEventListener('click', event => {
    event.stopPropagation();
    mainActionsRow?.classList.toggle('open');
});

document.addEventListener('click', event => {
    if (!mainActionsRow || !mobileActionsBtn) return;
    if (!mainActionsRow.contains(event.target) && !mobileActionsBtn.contains(event.target)) {
        closeMobileActions();
    }
});

mainActionsRow?.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', closeMobileActions);
});

navHome?.addEventListener('click', () => {
    showView('main');
});

navGraph?.addEventListener('click', () => {
    btnGraph.click();
});

navHistory?.addEventListener('click', () => {
    openFullHistory();
});

navGestion?.addEventListener('click', () => {
    if (!AUTH.isRole('admin') && !AUTH.isRole('dev')) {
        showToast('Action non autorisee');
        return;
    }

    btngest.click();
});

mapToggle?.addEventListener('click', event => {
    if (event.target.closest('#btn-user-position')) return;

    mapCard?.classList.toggle('map-open');
    setTimeout(() => leafletMap?.invalidateSize(), 120);
});

btnUserPosition?.addEventListener('click', event => {
    event.stopPropagation();
    updateUserPosition({ centerOnUser: true });
});
