import * as THREE from './three.module.js';

function normalizeTexPath(name){
  let n = String(name || '').replace(/\\/g,'/').toLowerCase();
  n = n.replace(/^\.+\//, '');
  n = n.replace(/^(images|texpages)\//, '');
  n = n.replace(/^classic\/texpages\//, '');
  n = n.replace(/texpages\/texpages\//g, 'texpages/');
  return n;
}

let showPanelIdsCheckbox;
import { TILESETS, getTileCount, loadAllTiles, clearTileCache } from './tileset.js';
import { loadMapUnified, getTilesetIndexFromTtp } from './maploader.js';
import { convertGammaGameMapToClassic, parseTTypes } from './convert.js';
import { cameraState, resetCameraTarget, setupKeyboard } from './camera.js';
import { parsePie, loadPieGeometry } from "./pie.js";
import { buildStructureGroup } from "./structureGroup.js";
import { STRUCTURE_TURRETS } from "./structure_turrets.js";
import { loadSensorDefs, getSensorModels } from "./sensors.js";
import { buildDroidGroup } from "./droidGroup.js";

let bodyDefs, propDefs, weaponDefs, templateDefs;
async function loadComponentDefs() {
  if (bodyDefs && propDefs && weaponDefs && templateDefs) return;
  const base = (typeof window !== 'undefined' && window.PIES_BASE) ? window.PIES_BASE : 'pies/';
  [bodyDefs, propDefs, weaponDefs, templateDefs] = await Promise.all([
    fetch(base + 'components/bodies/body.json').then(r => r.json()).catch(() => ({})),
    fetch(base + 'components/prop/propulsion.json').then(r => r.json()).catch(() => ({})),
    fetch(base + 'components/weapons/weapons.json').then(r => r.json()).catch(() => ({})),
    fetch(base + 'components/templates.json').then(r => r.json()).catch(() => ({}))
  ]);
}

const tilesetSelect = document.getElementById('tilesetSelect');
const fileListDiv = document.getElementById('fileList');
const infoDiv = document.getElementById('info');
const compassNeedle = document.getElementById('compassNeedle');
const mapFilenameSpan = document.getElementById('mapFilename');
const uiBar = document.getElementById('uiBar');
const threeContainer = document.getElementById('threeContainer');
const loadingOverlay = document.getElementById('loadingOverlay');
const loadingDetail = document.getElementById('loadingDetail');
const loadingBarInner = document.getElementById('loadingBarInner');
const loadingPercent = document.getElementById('loadingPercent');
const overlayMsg = document.getElementById('overlayMsg');
const overlayText = document.getElementById('overlayText');
function setLoadingProgress(detail, percent) {
  const pct = Math.max(0, Math.min(100, Math.round(percent || 0)));
  if (loadingOverlay) loadingOverlay.classList.remove('hidden');
  if (loadingDetail) loadingDetail.textContent = detail || 'Loading...';
  if (loadingBarInner) loadingBarInner.style.width = pct + '%';
  if (loadingPercent) loadingPercent.textContent = pct + '%';
  setFileStatus((detail || 'Loading...') + ' ' + pct + '%');
}
function hideLoadingProgress() {
  if (loadingOverlay) loadingOverlay.classList.add('hidden');
}
function setOverlayText(msg){
  if (overlayText) { overlayText.textContent = msg; }
  else if (overlayMsg) { overlayMsg.textContent = msg; }
}
function showOverlay(msg){
  if (typeof msg === 'string' && msg.length > 0) {
    setOverlayText(msg);
    if (overlayText) overlayText.style.display = 'block';
  } else {
    if (overlayText) overlayText.style.display = 'none';
  }
  if (overlayMsg) overlayMsg.style.display = 'flex';
}
window.showOverlay = showOverlay;
function hideOverlay(){
  if (overlayMsg) overlayMsg.style.display = 'none';
  if (typeof document !== 'undefined' && document.body) {
    document.body.classList.remove('overlay-open');
  }
  if (typeof window !== 'undefined' && window.UI && typeof window.UI.showTopBar === 'function') {
    window.UI.showTopBar(true);
  }
}
window.hideOverlay = hideOverlay;

// ---- Configurable assets base paths (root defaults) ----
if (typeof window !== 'undefined') {
  if (typeof window.STRUCTURES_JSON === 'undefined') window.STRUCTURES_JSON = 'structure.json';
  if (typeof window.SENSORS_JSON === 'undefined') window.SENSORS_JSON = 'sensor.json';
  if (typeof window.PIES_BASE === 'undefined') window.PIES_BASE = 'pies/';
  if (typeof window.TEX_BASE === 'undefined') window.TEX_BASE = 'classic/texpages/texpages/';
}

// Extend tileset codes to support Gamma maps (0x0300)
export const TTP_TILESET_MAP = {
  0x0100: 0, // Arizona
  0x0200: 1, // Urban
  0x0000: 2, // Rockies
  0x0300: 3  // Gamma
};

const showTileIdCheckbox = document.getElementById('showTileId');
const showHeightBtn = document.getElementById('showHeightBtn');
let showHeight = false;
if (showHeightBtn) {
  showHeightBtn.addEventListener('click', () => {
    showHeight = !showHeight;
    showHeightBtn.classList.toggle('active', showHeight);
    drawMap3D();
  });
}

// Tile types on 3D map toggle
const showTileTypesOnMapCheckbox = document.getElementById('showTileTypesOnMap');
const showTileTypesCheckbox = document.getElementById('displayTileTypes');
const showTileInfoCheckbox = document.getElementById('showTileInfo');
const tileInfoButtonsDiv = document.getElementById('tileInfoButtons');
const tileOptionsBox = document.getElementById('tileOptions');
const tileShowBtn = document.getElementById('tileShowBtn');

showPanelIdsCheckbox = document.getElementById('showPanelIds');
if (showPanelIdsCheckbox) {
  showPanelIdsCheckbox.addEventListener('change', () => {
    if (typeof renderTexturePalette === 'function') renderTexturePalette();
  });
}

let scene, camera, renderer, mesh;
let tileImages = [];
let tileTypesById = [];
let selectedTileId = 0;
let selectedRotation = 0;
const TILE_TYPE_COLORS = [
  '#ff0','#0f0','#f00','#00f','#f0f','#0ff','#fff','#000','#888','#ffa500','#8a2be2','#00ced1'
];
const TILE_ICON_SIZE = 41;
let animationId = null;
const PLAYER_COLORS = [
  0xff0000, 0x0000ff, 0x00ff00, 0xffff00, 0xff00ff,
  0x00ffff, 0xffffff, 0x888888, 0xff8800, 0x0088ff
];
if (showTileInfoCheckbox && tileInfoButtonsDiv) {
  const updateTileInfoVisibility = () => {
    const visible = showTileInfoCheckbox.checked;
    tileInfoButtonsDiv.style.display = visible ? 'grid' : 'none';
    if (tileOptionsBox) tileOptionsBox.style.display = visible ? 'block' : 'none';

    const typeToggle = document.getElementById('displayTileTypes');
    const tileIdLabel = document.querySelector('label[for="showPanelIds"]');
    const typeLabel = document.querySelector('label[for="displayTileTypes"]');

    if (showPanelIdsCheckbox) showPanelIdsCheckbox.style.display = visible ? '' : 'none';
    if (tileIdLabel) tileIdLabel.style.display = visible ? '' : 'none';
    if (typeToggle) typeToggle.style.display = visible ? '' : 'none';
    if (typeLabel) typeLabel.style.display = visible ? '' : 'none';

    if (tileShowBtn) tileShowBtn.classList.toggle('active', visible);

    if (scene && typeof drawMap3D === 'function') drawMap3D();
    if (typeof renderTexturePalette === 'function') renderTexturePalette();
  };
  showTileInfoCheckbox.addEventListener('change', updateTileInfoVisibility);
  updateTileInfoVisibility();
}
let STRUCTURE_DEFS = [];
let selectedStructureIndex = -1;
let objectsGroup = new THREE.Group();
let selectedStructureRotation = 0;
let structureMode = 'view';
let selectedStructureGroup = null;
let selectedStructureBlinkHelper = null;
let selectedStructureBlinkTimer = null;
let hoveredStructureGroup = null;
let hoveredStructureHelper = null;
let previewScene = null;
let previewCamera = null;
let previewRenderer = null;
let previewMesh = null;
let previewLoadToken = 0;
let highlightLoadToken = 0;

function disposeObject3D(obj) {
  obj.traverse(child => {
    if (!child.isMesh) return;
    if (child.geometry && typeof child.geometry.dispose === 'function') child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach(mat => {
      if (!mat) return;
      if (mat.map && typeof mat.map.dispose === 'function') mat.map.dispose();
      if (typeof mat.dispose === 'function') mat.dispose();
    });
  });
}

function clearMapObjects() {
  if (!objectsGroup) return;
  clearSelectedStructure();
  clearHoveredStructure();
  for (let i = objectsGroup.children.length - 1; i >= 0; i--) {
    const obj = objectsGroup.children[i];
    disposeObject3D(obj);
    objectsGroup.remove(obj);
  }
}

function clearStructurePlacementPreview() {
  highlightLoadToken++;
  if (highlightMesh) {
    if (scene) scene.remove(highlightMesh);
    if (highlightMesh.geometry) highlightMesh.geometry.dispose();
    if (highlightMesh.material) highlightMesh.material.dispose();
    highlightMesh = null;
  }
  if (previewGroup) {
    disposeObject3D(previewGroup);
    if (scene) scene.remove(previewGroup);
    previewGroup = null;
  }
  if (highlightModelGroup) {
    disposeObject3D(highlightModelGroup);
    if (scene) scene.remove(highlightModelGroup);
    highlightModelGroup = null;
  }
}

function getStructureRootFromObject(obj) {
  let cur = obj;
  while (cur && cur !== objectsGroup) {
    if (cur.parent === objectsGroup) return cur;
    cur = cur.parent;
  }
  return null;
}

function pickStructureFromEvent(event) {
  if (!event || !threeContainer || !camera || !objectsGroup) return null;
  const rect = threeContainer.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(objectsGroup.children, true);
  return hits.length ? getStructureRootFromObject(hits[0].object) : null;
}

function describeStructureGroup(group) {
  if (!group) return 'Click a structure on the map to view its info.';
  const data = group.userData?.structureExport || {};
  const structureId = data.name || data.id;
  const def = getStructureDefById(structureId) || {};
  const player = getStructurePlayer(group);
  const centerX = group.position.x + (group.userData.centerX || 0);
  const centerY = group.position.z + (group.userData.centerZ || 0);
  const tileX = Math.max(0, Math.min(mapW - 1, Math.round(centerX - 0.5)));
  const tileY = Math.max(0, Math.min(mapH - 1, Math.round(centerY - 0.5)));
  const name = def.name || data.name || data.id || 'Unknown structure';
  const lines = [
    'Selected structure',
    'Name: ' + name,
    'ID: ' + (structureId || def.id || 'unknown'),
    'Player: ' + player
  ];
  if (def.categoryName || def.category !== undefined) lines.push('Type: ' + (def.categoryName || STRUCTURE_CATEGORY_NAMES[def.category] || 'unknown'));
  lines.push('Tile: ' + tileX + ', ' + tileY);
  if (data.sizeX && data.sizeY) lines.push('Size: ' + data.sizeX + 'x' + data.sizeY);
  lines.push('Rotation: ' + getStructureRotationDegrees(group) + ' deg');
  return lines.join('\n');
}

function updateStructureInfo(group, fallback) {
  const info = document.getElementById('structureInfo');
  if (!info) return;
  info.textContent = group ? describeStructureGroup(group) : fallback || '';
  updateStructurePlayerControls(group);
  updateStructureRotationControls(group);
}

function normalizeDegrees(value) {
  const raw = parseFloat(value);
  if (!Number.isFinite(raw)) return 0;
  return ((Math.round(raw) % 360) + 360) % 360;
}

function degreesToWzAngle(deg) {
  return Math.round(normalizeDegrees(deg) * 65536 / 360);
}

function getStructureRotationDegrees(group) {
  const data = group?.userData?.structureExport || {};
  if (data.rotDeg !== undefined) return normalizeDegrees(data.rotDeg);
  return normalizeDegrees((data.rot || 0) * 90);
}

function setStructureRotationDegrees(group, degrees) {
  if (!group?.userData?.structureExport) return;
  const deg = normalizeDegrees(degrees);
  const data = group.userData.structureExport;
  data.rotDeg = deg;
  data.rot = Math.round(deg / 90) % 4;
  group.rotation.y = -deg * Math.PI / 180;
  group.updateMatrixWorld(true);
  if (selectedStructureBlinkHelper) selectedStructureBlinkHelper.update();
  if (hoveredStructureHelper) hoveredStructureHelper.update();
  updateStructureInfo(group);
}

function getStructurePlayer(group) {
  const data = group?.userData?.structureExport || {};
  const source = data.sourceEntry || {};
  const raw = data.player ?? source.player ?? source.startpos ?? 0;
  const player = parseInt(raw, 10);
  return Number.isFinite(player) ? Math.max(0, Math.min(10, player)) : 0;
}

function setStructurePlayer(group, player) {
  if (!group?.userData?.structureExport) return;
  const nextPlayer = Math.max(0, Math.min(10, parseInt(player, 10) || 0));
  const data = group.userData.structureExport;
  data.player = nextPlayer;
  if (data.sourceEntry && typeof data.sourceEntry === 'object') {
    if (data.sourceEntry.player !== undefined) data.sourceEntry.player = nextPlayer;
    else data.sourceEntry.startpos = nextPlayer;
  }
  updateStructureInfo(group);
}

function updateStructurePlayerControls(group) {
  const controls = document.getElementById('structurePlayerControls');
  const select = document.getElementById('structurePlayerSelect');
  if (!controls || !select) return;
  const show = structureMode === 'view' && !!group;
  controls.style.display = show ? 'flex' : 'none';
  if (!show) return;
  if (!select.options.length) {
    for (let i = 0; i <= 10; i++) {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = 'Player ' + i;
      select.appendChild(opt);
    }
  }
  select.value = String(getStructurePlayer(group));
}

function updateStructureRotationControls(group) {
  const controls = document.getElementById('structureRotationControls');
  const input = document.getElementById('structureRotationInput');
  if (!controls || !input) return;
  const show = structureMode === 'view' && !!group;
  controls.style.display = show ? 'flex' : 'none';
  if (!show) return;
  input.value = String(getStructureRotationDegrees(group));
}

function clearSelectedStructure() {
  selectedStructureGroup = null;
  if (selectedStructureBlinkTimer) {
    clearInterval(selectedStructureBlinkTimer);
    selectedStructureBlinkTimer = null;
  }
  if (selectedStructureBlinkHelper) {
    if (scene) scene.remove(selectedStructureBlinkHelper);
    selectedStructureBlinkHelper = null;
  }
}

function selectStructureGroup(group) {
  clearSelectedStructure();
  if (!group) {
    updateStructureInfo(null, 'No structure selected.');
    return;
  }
  selectedStructureGroup = group;
  selectedStructureBlinkHelper = new THREE.BoxHelper(group, 0x6cf527);
  selectedStructureBlinkHelper.layers.set(1);
  if (scene) scene.add(selectedStructureBlinkHelper);
  selectedStructureBlinkTimer = setInterval(() => {
    if (!selectedStructureBlinkHelper) return;
    selectedStructureBlinkHelper.visible = !selectedStructureBlinkHelper.visible;
    selectedStructureBlinkHelper.update();
  }, 350);
  updateStructureInfo(group);
}

function clearHoveredStructure() {
  hoveredStructureGroup = null;
  if (hoveredStructureHelper) {
    if (scene) scene.remove(hoveredStructureHelper);
    hoveredStructureHelper = null;
  }
}

function setHoveredStructure(group) {
  if (hoveredStructureGroup === group) {
    if (hoveredStructureHelper) hoveredStructureHelper.update();
    return;
  }
  clearHoveredStructure();
  if (!group) return;
  hoveredStructureGroup = group;
  hoveredStructureHelper = new THREE.BoxHelper(group, structureMode === 'delete' ? 0xff5555 : 0x66aaff);
  hoveredStructureHelper.layers.set(1);
  if (scene) scene.add(hoveredStructureHelper);
}

function removeStructureGroup(group) {
  if (!group || !objectsGroup.children.includes(group)) return false;
  if (selectedStructureGroup === group) clearSelectedStructure();
  if (hoveredStructureGroup === group) clearHoveredStructure();
  objectsGroup.remove(group);
  drawMap3D();
  return true;
}

function getStructureDefById(id) {
  const key = String(id || '').toLowerCase();
  return STRUCTURE_DEFS.find(def => String(def.id || '').toLowerCase() === key) || null;
}

function getStructureGroupDef(group) {
  return getStructureDefById(group?.userData?.structureExport?.name);
}

function getStructureFootprint(group) {
  const data = group?.userData?.structureExport;
  if (!data) return null;
  const sizeX = data.sizeX || 1;
  const sizeY = data.sizeY || 1;
  const centerX = group.position.x + (group.userData.centerX || 0);
  const centerY = group.position.z + (group.userData.centerZ || 0);
  const x = Math.round(centerX - sizeX / 2);
  const y = Math.round(centerY - sizeY / 2);
  return { x, y, sizeX, sizeY };
}

function footprintsOverlap(a, b) {
  return a.x < b.x + b.sizeX &&
    a.x + a.sizeX > b.x &&
    a.y < b.y + b.sizeY &&
    a.y + a.sizeY > b.y;
}

function footprintsMatch(a, b) {
  return a.x === b.x && a.y === b.y && a.sizeX === b.sizeX && a.sizeY === b.sizeY;
}

function getModuleParentTypes(def) {
  const type = String(def?.type || '').toLowerCase();
  return STRUCTURE_MODULE_PARENT_TYPES[type] || null;
}

function getStructurePlacementValidity(def, tileX, tileY, sizeX, sizeY) {
  const target = { x: tileX, y: tileY, sizeX, sizeY };
  if (tileX < 0 || tileY < 0 || tileX + sizeX > mapW || tileY + sizeY > mapH) {
    return { valid: false, reason: 'Structure does not fit inside the map.' };
  }

  const overlaps = [];
  objectsGroup.children.forEach(group => {
    const footprint = getStructureFootprint(group);
    if (footprint && footprintsOverlap(target, footprint)) {
      overlaps.push({ group, footprint, def: getStructureGroupDef(group) });
    }
  });

  const moduleRule = getModuleParentTypes(def);
  if (!moduleRule) {
    return overlaps.length ? { valid: false, reason: 'That tile is already occupied.' } : { valid: true };
  }

  let foundParent = false;
  let existingModules = 0;
  for (const item of overlaps) {
    const type = String(item.def?.type || '').toLowerCase();
    const id = String(item.def?.id || '').toLowerCase();
    const isSameModule = id && id === String(def.id || '').toLowerCase();
    const isMatchingParent = moduleRule.parents.has(type) && footprintsMatch(target, item.footprint);
    foundParent = foundParent || isMatchingParent;
    if (isSameModule && footprintsMatch(target, item.footprint)) existingModules++;
    if (!isMatchingParent && !isSameModule) {
      return { valid: false, reason: 'Module must be placed on a matching structure.' };
    }
  }

  if (existingModules >= moduleRule.max) {
    return { valid: false, reason: 'This structure already has the maximum number of modules.' };
  }
  return foundParent ? { valid: true } : { valid: false, reason: 'Module must be placed on a matching structure.' };
}

function tintPlacementPreview(group, valid) {
  if (valid) return;
  group.traverse(child => {
    if (!child.isMesh || !child.material) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    const tinted = materials.map(mat => {
      const next = mat.clone();
      if (next.color) next.color.set(0xff3333);
      if (next.emissive) next.emissive.set(0x661111);
      next.transparent = true;
      next.opacity = Math.min(next.opacity || 1, 0.7);
      return next;
    });
    child.material = Array.isArray(child.material) ? tinted : tinted[0];
  });
}

function updateStructureModeUI() {
  document.querySelectorAll('[data-structure-mode]').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-structure-mode') === structureMode);
  });
  const buildControls = document.getElementById('structureBuildControls');
  const info = document.getElementById('structureInfo');
  const hint = document.getElementById('structureModeHint');
  if (buildControls) buildControls.style.display = structureMode === 'build' ? 'block' : 'none';
  if (info) info.style.display = structureMode === 'build' ? 'none' : 'block';
  if (hint) {
    if (structureMode === 'view') hint.textContent = 'Click a structure on the map to view its info. The selected structure blinks.';
    else if (structureMode === 'delete') hint.textContent = 'Hover a structure and click mouse1 to remove it from the map.';
    else hint.textContent = 'Click on the map to place the selected structure. Structures snap to the terrain and cannot overlap the map boundary.';
  }
  updateStructurePlayerControls(structureMode === 'view' ? selectedStructureGroup : null);
  updateStructureRotationControls(structureMode === 'view' ? selectedStructureGroup : null);
  if (structureMode === 'build') {
    clearHoveredStructure();
    clearSelectedStructure();
  } else {
    clearStructurePlacementPreview();
    updateStructureInfo(selectedStructureGroup, structureMode === 'delete' ? 'Hover and click a structure to delete it.' : 'Click a structure on the map to view its info.');
  }
}

function setStructureMode(mode) {
  if (!['view', 'build', 'delete'].includes(mode)) return;
  structureMode = mode;
  updateStructureModeUI();
  if (lastMouseEvent) updateHighlight(lastMouseEvent);
}

const STRUCTURE_CATEGORY_NAMES = [
  'Base buildings',
  'Sensors',
  'Walls',
  'Towers',
  'Bunkers',
  'Hardpoints',
  'Fortresses',
  'Artillery emplacements',
  'Anti-Air batteries',
  'Other defenses',
  'Unavailable buildings'
];

const BASE_STRUCTURE_IDS = new Set([
  'a0commandcentre',
  'a0comdroidcontrol',
  'a0powergenerator',
  'a0powmod1',
  'a0researchfacility',
  'a0researchmodule1',
  'a0lightfactory',
  'a0cyborgfactory',
  'a0facmod1',
  'a0vtolfactory1',
  'a0repaircentre3',
  'a0vtolpad',
  'a0resourceextractor',
  'a0sat-linkcentre',
  'a0lassatcommand'
]);

const STRUCTURE_MODULE_PARENT_TYPES = {
  'factory module': { parents: new Set(['factory', 'vtol factory']), max: 2 },
  'power module': { parents: new Set(['power generator']), max: 1 },
  'research module': { parents: new Set(['research']), max: 1 }
};

const SENSOR_STRUCTURE_IDS = new Set([
  'sys-sensotower01',
  'sys-sensotower02',
  'sys-radardetector01',
  'sys-cb-tower01',
  'sys-vtol-radartower01',
  'sys-vtol-cb-tower01',
  'sys-sensotowerws'
]);

const SENSOR_STRUCTURE_ORDER = [
  'sys-sensotower01',
  'sys-sensotower02',
  'sys-radardetector01',
  'sys-cb-tower01',
  'sys-vtol-radartower01',
  'sys-vtol-cb-tower01',
  'sys-sensotowerws'
];

const WALL_STRUCTURE_IDS = new Set([
  'a0tanktrap',
  'a0hardcretemk1cwall',
  'a0hardcretemk1wall',
  'a0hardcretemk1gate'
]);

const ALLOWED_TOWER_IDS = new Set([
  'guardtower1',
  'guardtower6',
  'guardtower5',
  'guardtower-rail1',
  'guardtower-atmiss',
  'sys-spytower',
  'guardtower-beamlas',
  'sys-sensotower01',
  'sys-sensotower02',
  'sys-radardetector01',
  'sys-cb-tower01',
  'sys-vtol-radartower01',
  'sys-vtol-cb-tower01',
  'sys-sensotowerws'
]);

const ALLOWED_BUNKER_IDS = new Set([
  'pillbox1',
  'pillbox5',
  'pillbox4',
  'pillbox-cannon6',
  'tower-projector',
  'pillbox-rotmg',
  'plasmite-flamer-bunker'
]);

const ALLOWED_HARDPOINT_IDS = new Set([
  'wall-rotmg',
  'wall-vulcancan',
  'walltower-doubleaagun',
  'walltower-doubleaagun02',
  'walltower-hpvcannon',
  'walltower-hvatrocket',
  'walltower-pulselas',
  'walltower-quadrotaagun',
  'walltower-rail2',
  'walltower-rail3',
  'walltower-samhvy',
  'walltower-samsite',
  'walltower-twinassaultgun',
  'walltower-atmiss',
  'walltower-emp',
  'walltower01',
  'walltower02',
  'walltower03',
  'walltower04',
  'walltower06'
]);

const ALLOWED_FORTRESS_IDS = new Set([
  'x-super-cannon',
  'x-super-rocket',
  'x-super-missile',
  'x-super-massdriver'
]);

const ALLOWED_ARTILLERY_IDS = new Set([
  'emplacement-mortarpit01',
  'emplacement-mrl-pit',
  'emplacement-mortarpit02',
  'emplacement-rotmor',
  'emplacement-mortarpit-incendiary',
  'emplacement-mrlhvy-pit',
  'emplacement-rocket06-idf',
  'emplacement-howitzer105',
  'emplacement-howitzer-incendiary',
  'emplacement-rothow',
  'emplacement-howitzer150',
  'emplacement-mortaremp',
  'emplacement-mdart-pit',
  'emplacement-heavyplasmalauncher',
  'emplacement-hvart-pit'
]);

const ALLOWED_ANTI_AIR_IDS = new Set([
  'aasite-quadmg1',
  'p0-aasite-sunburst',
  'aasite-quadbof',
  'aasite-quadrotmg',
  'aasite-quadbof02',
  'p0-aasite-sam1',
  'p0-aasite-laser',
  'p0-aasite-sam2'
]);

const ALLOWED_OTHER_DEFENSE_IDS = new Set([
  'emplacement-hpvcannon',
  'emplacement-hvyatrocket',
  'emplacement-plasmacannon',
  'emplacement-prislas',
  'emplacement-heavylaser',
  'emplacement-rail2',
  'emplacement-rail3'
]);

const UNAVAILABLE_STRUCTURE_IDS = new Set([
  'a0ademolishstructure',
  'a0bababunker',
  'a0babacornerwall',
  'a0babafactory',
  'a0babaflametower',
  'a0babaguntower',
  'a0babaguntowerend',
  'a0babahorizontalwall',
  'a0babamortarpit',
  'a0babapowergenerator',
  'a0babarocketpit',
  'a0babarocketpitat',
  'a0babavtolfactory',
  'a0babavtolpad',
  'a0cannontower',
  'a0commandcentreco',
  'a0commandcentrene',
  'a0commandcentrenp',
  'bbaatow',
  'co-tower-hvatrkt',
  'co-tower-hvcan',
  'co-tower-hvflame',
  'co-tower-ltatrkt',
  'co-tower-mdcan',
  'co-tower-mg3',
  'co-tower-rotmg',
  'co-walltower-hvcan',
  'co-walltower-rotcan',
  'collectivecwall',
  'collectivewall',
  'coolingtower',
  'ecm1pylonmk1',
  'guardtower-rotmg',
  'guardtower2',
  'guardtower3',
  'guardtower4',
  'lookouttower',
  'nexuscwall',
  'nexuswall',
  'nuclearreactor',
  'nx-anti-satsite',
  'nx-cruisesite',
  'nx-emp-medartmiss-pit',
  'nx-emp-multiartmiss-pit',
  'nx-emp-plasma-pit',
  'nx-tower-atmiss',
  'nx-tower-pulselas',
  'nx-tower-rail1',
  'nx-walltower-beamlas',
  'nx-walltower-rail2',
  'nx-walltower-rail3',
  'pillbox-cannon6',
  'pillbox-rotmg',
  'pillbox1',
  'pillbox4',
  'pillbox5',
  'plasmite-flamer-bunker',
  'scavrepaircentre',
  'sys-nexuslinktow',
  'sys-nx-cbtower',
  'sys-nx-sensortower',
  'sys-nx-vtol-cb-tow',
  'sys-nx-vtol-radtow',
  'tanktrapc',
  'tower-projector',
  'tower-rotmg',
  'tower-vulcancan',
  'uplinkcentre',
  'walltower-projector',
  'walltower05',
  'wreckedtransporter'
]);


async function loadStructureDefs() {
  try {
    const url = (typeof window !== 'undefined' && window.STRUCTURES_JSON) ? window.STRUCTURES_JSON : 'structure.json';
    const resp = await fetch(url, { cache: 'no-cache' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    STRUCTURE_DEFS = Object.values(data)
      .map(entry => {
        const pies = [];
        // Some structures list multiple model files representing
        // upgrade stages (e.g. factory modules). The first model is
        // the base building and subsequent entries include the whole
        // structure again with added modules. Previously we appended
        // every model which resulted in several complete buildings
        // being stacked vertically. Instead, ignore files that look
        // like module pieces and keep only the initial non‑module
        // model so we render the base structure without upgrades.
        const models = Array.isArray(entry.structureModel)
          ? entry.structureModel
          : (entry.structureModel ? [entry.structureModel] : []);
        const nonModules = models.filter(m => !/module/i.test(m));
        if (nonModules.length) {
          // Include the optional floor/base model first so the structure
          // sits on top of it, then add the main building geometry.
          if (entry.baseModel) {
            pies.push(entry.baseModel);
          }
          pies.push(nonModules[0]);

          // Some defensive structures, such as guard towers, list an
          // additional piece after the main building for the weapon mount
          // (e.g. "trl" turret boxes). Previously we discarded these,
          // which caused weapons to float above the tower. Append any
          // subsequent non-module models that look like turret pieces so
          // the weapon sits on the intended extra box.
          const turretPieces = nonModules
            .slice(1)
            .filter(m => /^tr/i.test(m));
          pies.push(...turretPieces);
        } else if (entry.baseModel) {
          pies.push(entry.baseModel);
        }

        return {
          id: entry.id,
          name: entry.name,
          sizeX: entry.width,
          sizeY: entry.breadth,
          pies,
          type: entry.type || '',
          strength: entry.strength || '',
          combinesWithWall: !!entry.combinesWithWall,
          sensorID: entry.sensorID
        };
      });
    populateStructureSelect();
  } catch (err) {
    console.error('Failed to load structure definitions:', err);
  }
}

function categorizeStructure(def) {
  const id = def.id.toLowerCase();
  const name = def.name.toLowerCase();
  const type = (def.type || '').toLowerCase();
  const strength = (def.strength || '').toLowerCase();

  if (
    UNAVAILABLE_STRUCTURE_IDS.has(id) ||
    name.includes('scavenger') ||
    id.startsWith('nx-') ||
    id.startsWith('co-') ||
    name.includes('*') ||
    type === 'demolish'
  ) {
    return 'Unavailable buildings';
  }

  if (BASE_STRUCTURE_IDS.has(id)) {
    return 'Base buildings';
  }

  if (SENSOR_STRUCTURE_IDS.has(id)) {
    return 'Sensors';
  }

  if (WALL_STRUCTURE_IDS.has(id)) {
    return 'Walls';
  }

  if (type === 'fortress') {
    return 'Fortresses';
  }

  if (ALLOWED_OTHER_DEFENSE_IDS.has(id)) {
    return 'Other defenses';
  }

  if (type !== 'defense') {
    return 'Unavailable buildings';
  }

  if (def.combinesWithWall) {
    return 'Hardpoints';
  }

  if (name.includes('bunker')) {
    return 'Bunkers';
  }

  if (
    name.includes('aa') ||
    name.includes('sam') ||
    name.includes('stormbringer') ||
    name.includes('vindicator')
  ) {
    return 'Anti-Air batteries';
  }

  if (
    name.includes('battery') ||
    name.includes('pit') ||
    name.includes('emplacement')
  ) {
    return 'Artillery emplacements';
  }

  if (id.includes('tower') || name.includes('tower')) {
    return 'Towers';
  }

  return 'Other defenses';
}

function populateStructureSelect() {
  const structureSelect = document.getElementById('structureSelect');
  if (!structureSelect) return;
  while (structureSelect.firstChild) {
    structureSelect.removeChild(structureSelect.firstChild);
  }
  const filterSelect = document.getElementById('structureFilter');
  const filter = filterSelect ? filterSelect.value : 'All types';
  const groups = Object.fromEntries(STRUCTURE_CATEGORY_NAMES.map(c => [c, []]));
  STRUCTURE_DEFS.forEach((def, idx) => {
    const idLower = def.id.toLowerCase();
    const nameLower = def.name.toLowerCase();
    const isTower = idLower.includes('tower') || nameLower.includes('tower');
    if (
      isTower &&
      !ALLOWED_TOWER_IDS.has(idLower) &&
      !ALLOWED_BUNKER_IDS.has(idLower) &&
      !ALLOWED_HARDPOINT_IDS.has(idLower) &&
      !ALLOWED_FORTRESS_IDS.has(idLower) &&
      !ALLOWED_ARTILLERY_IDS.has(idLower) &&
      !ALLOWED_ANTI_AIR_IDS.has(idLower) &&
      !ALLOWED_OTHER_DEFENSE_IDS.has(idLower) &&
      !UNAVAILABLE_STRUCTURE_IDS.has(idLower)
    ) return;
    const cat = categorizeStructure(def);
    if (cat === 'Bunkers' && !ALLOWED_BUNKER_IDS.has(idLower)) return;
    if (cat === 'Hardpoints' && !ALLOWED_HARDPOINT_IDS.has(idLower)) return;
    if (cat === 'Fortresses' && !ALLOWED_FORTRESS_IDS.has(idLower)) return;
    if (cat === 'Artillery emplacements' && !ALLOWED_ARTILLERY_IDS.has(idLower)) return;
    if (cat === 'Anti-Air batteries' && !ALLOWED_ANTI_AIR_IDS.has(idLower)) return;
    if (cat === 'Other defenses' && !ALLOWED_OTHER_DEFENSE_IDS.has(idLower)) return;
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push({ def, idx });
  });
  if (filter === 'All types') {
      STRUCTURE_CATEGORY_NAMES.forEach(cat => {
        const items = groups[cat];
        if (items && items.length) {
          const optgroup = document.createElement('optgroup');
          optgroup.label = cat;
          items
            .sort((a, b) => {
              if (cat === 'Sensors') {
                return (
                  SENSOR_STRUCTURE_ORDER.indexOf(a.def.id.toLowerCase()) -
                  SENSOR_STRUCTURE_ORDER.indexOf(b.def.id.toLowerCase())
                );
              }
              return a.def.name.localeCompare(b.def.name);
            })
            .forEach(({ def, idx }) => {
              const opt = document.createElement('option');
              opt.value = idx;
              opt.textContent = def.name;
              optgroup.appendChild(opt);
            });
          structureSelect.appendChild(optgroup);
        }
      });
    } else {
      const items = groups[filter] || [];
      items
        .sort((a, b) => {
          if (filter === 'Sensors') {
            return (
              SENSOR_STRUCTURE_ORDER.indexOf(a.def.id.toLowerCase()) -
              SENSOR_STRUCTURE_ORDER.indexOf(b.def.id.toLowerCase())
            );
          }
          return a.def.name.localeCompare(b.def.name);
        })
        .forEach(({ def, idx }) => {
          const opt = document.createElement('option');
          opt.value = idx;
          opt.textContent = def.name;
          structureSelect.appendChild(opt);
        });
    }
  selectedStructureIndex = -1;
  updateStructurePreview();
}

function populateStructureFilter() {
  const filterSelect = document.getElementById('structureFilter');
  if (!filterSelect) return;
  while (filterSelect.firstChild) {
    filterSelect.removeChild(filterSelect.firstChild);
  }
  const allOpt = document.createElement('option');
  allOpt.value = 'All types';
  allOpt.textContent = 'All types';
  filterSelect.appendChild(allOpt);
  STRUCTURE_CATEGORY_NAMES.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    filterSelect.appendChild(opt);
  });
  filterSelect.value = 'All types';
}
let activeTab = 'view';
window.activeTab = activeTab;
let brushSize = 1;
let heightMax = 255;
let heightInput;
let heightSlider;
let selectedHeight = 0;
let highlightMesh = null;
let previewGroup = null;
let lastMouseEvent = null;
let heightSelectionMode = false;
let heightBrushMode = false;
let heightSelectStart = null;
let heightSelectEnd = null;
let tileSelectionMode = false;
let tileBrushMode = false;
let tileSelectStart = null;
let tileSelectEnd = null;
let tileSelectionFixed = false;
const raycaster = new THREE.Raycaster();
raycaster.layers.set(0);
const mouse = new THREE.Vector2();
let highlightCachedId = null;
let highlightCachedRot = null;
let highlightModelGroup = null;
let highlightLoadingId = null;
let highlightLoadingRot = null;
// References to key DOM elements so helper functions can update them
let tileApplyBtn;
let tileCancelBtn;
let heightApplyBtn;
let heightCancelBtn;
let undoBtn;
let redoBtn;
const undoStack = [];
const redoStack = [];

function updateUndoRedoButtons() {
  if (undoBtn) undoBtn.disabled = undoStack.length === 0;
  if (redoBtn) redoBtn.disabled = redoStack.length === 0;
}

function pushUndo(action) {
  undoStack.push(action);
  redoStack.length = 0;
  updateUndoRedoButtons();
}

function updateHeightUI(maxVal) {
  heightMax = maxVal;
  if (heightInput) {
    heightInput.max = maxVal;
    if (parseInt(heightInput.value, 10) > maxVal) {
      heightInput.value = maxVal;
      selectedHeight = maxVal;
    }
  }
  if (heightSlider) {
    heightSlider.max = maxVal;
    if (parseInt(heightSlider.value, 10) > maxVal) {
      heightSlider.value = maxVal;
    }
  }
  const presets = document.querySelectorAll('.height-preset');
  if (presets.length >= 5) {
    const step = Math.round(maxVal / 4);
    const values = [0, step, step * 2, step * 3, maxVal];
    presets.forEach((btn, idx) => {
      const v = values[idx];
      btn.textContent = v;
      btn.setAttribute('data-val', v);
    });
  }
}

function setMapState(w, h, tiles, rotations, heights, xflip = [], yflip = [], triflip = []) {
  mapW = w;
  mapH = h;
  mapTiles = tiles;
  mapRotations = rotations;
  mapHeights = heights;
  mapXFlip = xflip.length ? xflip : Array(h).fill().map(() => Array(w).fill(false));
  mapYFlip = yflip.length ? yflip : Array(h).fill().map(() => Array(w).fill(false));
  mapTriFlip = triflip.length ? triflip : Array(h).fill().map(() => Array(w).fill(false));

  const sizeXInput = document.getElementById('sizeXInput');
  const sizeYInput = document.getElementById('sizeYInput');
  const sizeXSlider = document.getElementById('sizeXSlider');
  const sizeYSlider = document.getElementById('sizeYSlider');
  if (sizeXInput) sizeXInput.value = w;
  if (sizeYInput) sizeYInput.value = h;
  if (sizeXSlider) sizeXSlider.value = w;
  if (sizeYSlider) sizeYSlider.value = h;
  const applySizeBtn = document.getElementById('applySizeBtn');
  if (applySizeBtn) applySizeBtn.disabled = true;

  resetCameraTarget(mapW, mapH, threeContainer);
  drawMap3D();

  if (highlightMesh) {
    scene.remove(highlightMesh);
    highlightMesh = null;
  }
  if (previewGroup) {
    previewGroup.traverse(child => {
      if (child.isMesh) {
        if (child.material && child.material.map) child.material.map.dispose();
        if (child.material) child.material.dispose();
        if (child.geometry) child.geometry.dispose();
      }
    });
    scene.remove(previewGroup);
    previewGroup = null;
  }
}

function applyAction(action, mode) {
  if (!action) return;
  if (action.type === 'tiles') {
    for (const c of action.changes) {
      const tile = mode === 'undo' ? c.oldTile : c.newTile;
      const rot = mode === 'undo' ? c.oldRot : c.newRot;
      mapTiles[c.y][c.x] = tile;
      mapRotations[c.y][c.x] = rot;
    }
    drawMap3D();
  } else if (action.type === 'height') {
    for (const c of action.changes) {
      const h = mode === 'undo' ? c.oldHeight : c.newHeight;
      mapHeights[c.y][c.x] = h;
    }
    drawMap3D();
  } else if (action.type === 'resize') {
    const state = mode === 'undo' ? action.oldState : action.newState;
    setMapState(state.w, state.h, state.tiles, state.rotations, state.heights, state.xflip, state.yflip, state.triflip);
  } else if (action.type === 'structure') {
    if (mode === 'undo') {
      removeStructureGroup(action.group);
    } else {
      objectsGroup.add(action.group);
      if (!scene.children.includes(objectsGroup)) scene.add(objectsGroup);
      drawMap3D();
    }
  } else if (action.type === 'structure-delete') {
    if (mode === 'undo') {
      objectsGroup.add(action.group);
      if (!scene.children.includes(objectsGroup)) scene.add(objectsGroup);
      drawMap3D();
    } else {
      removeStructureGroup(action.group);
    }
  }
}

function undo() {
  const action = undoStack.pop();
  if (!action) return;
  applyAction(action, 'undo');
  redoStack.push(action);
  updateUndoRedoButtons();
}

function redo() {
  const action = redoStack.pop();
  if (!action) return;
  applyAction(action, 'redo');
  undoStack.push(action);
  updateUndoRedoButtons();
}

  function updateTileApplyBtn() {
    if (!tileApplyBtn) return;
    if (tileSelectControls) {
      tileSelectControls.style.display = tileSelectionMode ? 'flex' : 'none';
    }
    if (!tileSelectionMode) {
      tileApplyBtn.disabled = true;
      tileApplyBtn.classList.remove('ready');
      if (tileCancelBtn) tileCancelBtn.disabled = true;
    } else {
      tileApplyBtn.disabled = false;
      const hasSelection = tileSelectStart && tileSelectEnd && tileSelectionFixed;
      tileApplyBtn.classList.toggle('ready', !!hasSelection);
      if (tileCancelBtn) tileCancelBtn.disabled = !hasSelection;
    }
  }

  function updateHeightApplyBtn() {
    if (!heightApplyBtn) return;
    if (heightSelectControls) {
      heightSelectControls.style.display = heightSelectionMode ? 'flex' : 'none';
    }
    if (!heightSelectionMode) {
      heightApplyBtn.disabled = true;
      heightApplyBtn.classList.remove('ready');
      if (heightCancelBtn) heightCancelBtn.disabled = true;
    } else {
      heightApplyBtn.disabled = false;
      const hasSelection = heightSelectStart && heightSelectEnd;
      heightApplyBtn.classList.toggle('ready', !!hasSelection);
      if (heightCancelBtn) heightCancelBtn.disabled = !hasSelection;
    }
  }

function setFileStatus(text) {
  const status = document.getElementById('fileStatus');
  if (status) status.textContent = text || '';
}

function getCurrentMapFilename() {
  const raw = (mapFilenameSpan && mapFilenameSpan.textContent ? mapFilenameSpan.textContent : 'untitled-map').trim();
  return raw || 'untitled-map';
}

let currentMapArchive = null;
let currentMapArchivePath = null;
let currentMapExportInfo = null;
let currentStructArchivePath = null;
let currentStructJsonStyle = 'array';

function getSafeMapBase() {
  const base = getCurrentMapFilename()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '') || 'untitled-map';
  return base;
}

function makeSaveFilename() {
  const base = getSafeMapBase();
  return base + '.wz';
}

function getMapExportInfo(bytes) {
  if (!bytes || bytes.length < 16 || bytes[0] !== 0x6d || bytes[1] !== 0x61 || bytes[2] !== 0x70 || bytes[3] !== 0x20) {
    return null;
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const gamma = bytes[4] === 0x28;
  const version = gamma ? 40 : dv.getUint32(4, true);
  const width = dv.getUint32(8, true);
  const height = dv.getUint32(12, true);
  const bytesPerTile = gamma || version >= 39 ? 4 : 3;
  const gridEnd = 16 + width * height * bytesPerTile;
  return {
    gamma,
    version,
    width,
    height,
    bytesPerTile,
    header: bytes.slice(0, 16),
    tail: bytes.length > gridEnd ? bytes.slice(gridEnd) : null
  };
}

function buildTileNumber(x, y) {
  const tile = Math.max(0, Math.min(0x01ff, mapTiles[y]?.[x] || 0));
  const rot = (mapRotations[y]?.[x] || 0) & 0x03;
  const xflip = mapXFlip[y]?.[x] ? 0x8000 : 0;
  const yflip = mapYFlip[y]?.[x] ? 0x4000 : 0;
  const triflip = mapTriFlip[y]?.[x] ? 0x0800 : 0;
  return tile | (rot << 12) | xflip | yflip | triflip;
}

function getReusableMapTail(info) {
  if (!info || !info.tail || info.width !== mapW || info.height !== mapH) return null;
  return info.tail;
}

function buildClassicMapFileBytes(info = currentMapExportInfo) {
  const version = info && !info.gamma ? info.version : 10;
  const bytesPerTile = version >= 39 ? 4 : 3;
  const tail = getReusableMapTail(info);
  const out = new Uint8Array(16 + mapW * mapH * bytesPerTile + (tail ? tail.length : 0));
  out[0] = 0x6d; // m
  out[1] = 0x61; // a
  out[2] = 0x70; // p
  out[3] = 0x20; // space

  const dv = new DataView(out.buffer);
  dv.setUint32(4, version, true);
  dv.setUint32(8, mapW, true);
  dv.setUint32(12, mapH, true);

  let ofs = 16;
  for (let y = 0; y < mapH; y++) {
    for (let x = 0; x < mapW; x++) {
      const tilenum = buildTileNumber(x, y);
      dv.setUint16(ofs, tilenum, true);
      if (bytesPerTile === 4) {
        const height = Math.max(0, Math.min(1023, Math.round(mapHeights[y]?.[x] || 0)));
        dv.setUint16(ofs + 2, height > 255 ? height : height << 1, true);
      } else {
        const height = Math.max(0, Math.min(255, Math.round(mapHeights[y]?.[x] || 0)));
        dv.setUint8(ofs + 2, height);
      }
      ofs += bytesPerTile;
    }
  }
  if (tail) out.set(tail, ofs);
  return out;
}

function buildGammaMapFileBytes(info = currentMapExportInfo) {
  const tail = getReusableMapTail(info);
  const out = new Uint8Array(16 + mapW * mapH * 4 + (tail ? tail.length : 0));
  if (info && info.gamma && info.header) out.set(info.header.slice(0, 16), 0);
  out[0] = 0x6d; // m
  out[1] = 0x61; // a
  out[2] = 0x70; // p
  out[3] = 0x20; // space
  out[4] = 0x28; // Gamma map marker

  const dv = new DataView(out.buffer);
  dv.setUint32(8, mapW, true);
  dv.setUint32(12, mapH, true);

  let ofs = 16;
  for (let y = 0; y < mapH; y++) {
    for (let x = 0; x < mapW; x++) {
      const tile = Math.max(0, Math.min(0x3fff, mapTiles[y]?.[x] || 0));
      const rot = (mapRotations[y]?.[x] || 0) & 0x03;
      const gammaTile = (tile << 2) | rot;
      const height = Math.max(0, Math.min(1023, Math.round(mapHeights[y]?.[x] || 0)));
      dv.setUint16(ofs, gammaTile, true);
      dv.setUint16(ofs + 2, height > 255 ? height : height << 1, true);
      ofs += 4;
    }
  }
  if (tail) out.set(tail, ofs);
  return out;
}

function buildMapFileBytes() {
  if (currentMapExportInfo && currentMapExportInfo.gamma) {
    return buildGammaMapFileBytes(currentMapExportInfo);
  }
  if (currentMapExportInfo && !currentMapExportInfo.gamma) {
    return buildClassicMapFileBytes(currentMapExportInfo);
  }
  return buildGammaMapFileBytes(null);
}

function buildDefaultLevelJson(base) {
  return JSON.stringify({
    name: base,
    type: 'skirmish',
    players: 4,
    tileset: TILESETS[tilesetIndex]?.name || 'arizona',
    generator: 'warzone2100-mapmaker'
  }, null, 2);
}

function buildDefaultGamJson() {
  return JSON.stringify({
    version: 7,
    gameTime: 0,
    GameType: 0,
    ScrollMinX: 0,
    ScrollMinY: 0,
    ScrollMaxX: mapW,
    ScrollMaxY: mapH,
    levelName: ''
  }, null, 2);
}

async function updateGammaMetadata(zip, base) {
  if (!zip.file('level.json')) zip.file('level.json', buildDefaultLevelJson(base));
  if (!zip.file('gam.json')) {
    zip.file('gam.json', buildDefaultGamJson());
  } else {
    const text = await zip.file('gam.json').async('string');
    try {
      const gam = JSON.parse(text);
      gam.ScrollMaxX = mapW;
      gam.ScrollMaxY = mapH;
      zip.file('gam.json', JSON.stringify(gam, null, 2));
    } catch (e) {
      zip.file('gam.json', buildDefaultGamJson());
    }
  }
  if (!zip.file('struct.json')) zip.file('struct.json', JSON.stringify({ version: 2, structures: [] }));
  if (!zip.file('feature.json')) zip.file('feature.json', JSON.stringify({ version: 2, features: [] }));
  if (!zip.file('droid.json')) zip.file('droid.json', JSON.stringify({ version: 2, droids: [] }));
}

function markStructureForExport(group, def, rot, sizeX, sizeY, sourceEntry = null, style = currentStructJsonStyle) {
  if (!group || !def) return;
  group.userData.structureExport = {
    name: def.id,
    rot: rot || 0,
    rotDeg: normalizeDegrees((rot || 0) * 90),
    sizeX: sizeX || def.sizeX || 1,
    sizeY: sizeY || def.sizeY || 1,
    player: sourceEntry?.player ?? sourceEntry?.startpos ?? 0,
    sourceEntry,
    style
  };
}

function getStructureExportEntry(group, style, id) {
  const data = group?.userData?.structureExport;
  if (!data) return null;
  const def = STRUCTURE_DEFS.find(d => d.id === data.name || d.id.toLowerCase() === String(data.name).toLowerCase());
  if (!def) return null;
  const centerX = group.position.x + (group.userData.centerX || 0);
  const centerY = group.position.z + (group.userData.centerZ || 0);
  const tileX = Math.max(0, Math.min(mapW - 1, Math.round(centerX - 0.5)));
  const tileY = Math.max(0, Math.min(mapH - 1, Math.round(centerY - 0.5)));
  const height = Math.max(0, Math.round((mapHeights[tileY]?.[tileX] || 0) * 2));
  const base = data.sourceEntry && typeof data.sourceEntry === 'object' ? { ...data.sourceEntry } : {};
  base.name = def.id;
  base.id = base.id ?? id;
  if (style === 'object') {
    base.position = [Math.round(centerX * 128), Math.round(centerY * 128), height];
    base.rotation = [degreesToWzAngle(getStructureRotationDegrees(group)), 0, 0];
  } else {
    base.position = [Math.round(centerX * 128), Math.round(centerY * 128)];
    base.rotation = degreesToWzAngle(getStructureRotationDegrees(group));
  }
  const player = getStructurePlayer(group);
  if (base.player !== undefined) base.player = player;
  else base.startpos = player;
  return base;
}

function buildStructJson() {
  const style = currentStructJsonStyle || 'array';
  const entries = [];
  if (objectsGroup) {
    objectsGroup.children.forEach((group, idx) => {
      const entry = getStructureExportEntry(group, style, idx + 1);
      if (entry) entries.push(entry);
    });
  }
  if (style === 'object') {
    const out = {};
    entries.forEach((entry, idx) => {
      out['structure_' + String(idx + 1).padStart(4, '0')] = entry;
    });
    return JSON.stringify(out);
  }
  return JSON.stringify({ version: 2, structures: entries });
}

function savedMapNeedsAdvancedBases() {
  if (!objectsGroup) return false;
  return objectsGroup.children.some(group => {
    const data = group?.userData?.structureExport;
    if (!data) return false;
    const def = STRUCTURE_DEFS.find(d => d.id === data.name || d.id.toLowerCase() === String(data.name).toLowerCase());
    return def && (def.type === 'DEFENSE' || def.type === 'GATE' || def.type === 'WALL' || def.type === 'COMMAND_CONTROL');
  });
}

function updateStructJson(zip) {
  const structPath = currentStructArchivePath || 'struct.json';
  zip.file(structPath, buildStructJson());
}

async function buildWzFileBlob() {
  const zip = currentMapArchive || new JSZip();
  const base = getSafeMapBase();
  const mapPath = currentMapArchivePath || 'game.map';
  if (!currentMapArchive || (currentMapExportInfo && currentMapExportInfo.gamma)) {
    await updateGammaMetadata(zip, base);
  }
  updateStructJson(zip);
  zip.file(mapPath, buildMapFileBytes());
  return await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

async function saveCurrentMap() {
  try {
    setFileStatus('Packing .wz map...');
    setLoadingProgress('Packing WZ archive', 15);
    const blob = await buildWzFileBlob();
    setLoadingProgress('Preparing download', 95);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = makeSaveFilename();
    const savedName = a.download;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setLoadingProgress('WZ saved', 100);
    setTimeout(() => {
      hideLoadingProgress();
      const baseTip = savedMapNeedsAdvancedBases() ? ' Use Advanced Bases in Warzone to keep defenses/sensors.' : '';
      setFileStatus('Saved ' + savedName + baseTip);
    }, 600);
  } catch (err) {
    console.error('Failed to save WZ map:', err);
    setFileStatus('Failed to save .wz map.');
    setLoadingProgress('Failed to save WZ archive', 100);
  }
}
window.saveCurrentMap = saveCurrentMap;

function setupFilePanel() {
  const loadBtn = document.getElementById('fileLoadBtn');
  const serverBtn = document.getElementById('fileServerBtn');
  const saveBtn = document.getElementById('fileSaveBtn');
  const newBtn = document.getElementById('fileNewBtn');
  const input = document.getElementById('wzLoader');

  if (loadBtn && input) {
    loadBtn.addEventListener('click', () => {
      try { input.click(); } catch (e) {}
    });
  }
  if (serverBtn && fileListDiv) {
    serverBtn.addEventListener('click', async () => {
      if (!fileListDiv.children.length && typeof window.loadServerList === 'function') {
        await window.loadServerList();
      }
      fileListDiv.classList.toggle('hidden');
      setFileStatus(fileListDiv.classList.contains('hidden') ? 'Server map list closed.' : 'Select a server map from the list.');
    });
  }
  if (saveBtn) {
    saveBtn.addEventListener('click', saveCurrentMap);
  }
  if (newBtn) {
    newBtn.addEventListener('click', async () => {
      await newMap();
      if (mapFilenameSpan) mapFilenameSpan.textContent = 'Untitled Map';
      if (typeof window !== 'undefined' && window.UI) {
        if (typeof window.UI.setMapFilename === 'function') window.UI.setMapFilename('Untitled Map');
        if (typeof window.UI.showTopBar === 'function') window.UI.showTopBar(true);
      }
      hideOverlay();
      setFileStatus('Created a new blank map.');
    });
  }
}

const initDom = () => {
  loadTerrainSpeedModifiers();
  document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      setActiveTab(tab);
    });
  });
  const rotLeft = document.getElementById('rotateLeft');
  const rotRight = document.getElementById('rotateRight');
  rotLeft && rotLeft.addEventListener('click', () => {
    selectedRotation = (selectedRotation + 1) % 4;
    updateSelectedInfo();
    renderTexturePalette();
    if (lastMouseEvent) updateHighlight(lastMouseEvent);
  });
  rotRight && rotRight.addEventListener('click', () => {
    selectedRotation = (selectedRotation + 3) % 4;
    updateSelectedInfo();
    renderTexturePalette();
    if (lastMouseEvent) updateHighlight(lastMouseEvent);
  });
  updateSelectedInfo();
  setActiveTab(activeTab);
  setupFilePanel();

  const brushInput = document.getElementById('brushSizeInput');
  const brushSlider = document.getElementById('brushSizeSlider');
  const heightBrushInput = document.getElementById('heightBrushSizeInput');
  const heightBrushSlider = document.getElementById('heightBrushSizeSlider');

  const setBrush = (v) => {
    const n = parseInt(v, 10);
    brushSize = isNaN(n) ? 1 : Math.min(Math.max(n, 1), 255);
    if (brushInput) brushInput.value = brushSize;
    if (brushSlider) brushSlider.value = String(brushSize);
    if (heightBrushInput) heightBrushInput.value = brushSize;
    if (heightBrushSlider) heightBrushSlider.value = String(brushSize);
    if (lastMouseEvent) updateHighlight(lastMouseEvent);
  };

  if (brushInput) {
    brushSize = parseInt(brushInput.value, 10) || 1;
    brushInput.addEventListener('input', () => setBrush(brushInput.value));
    brushInput.addEventListener('change', () => setBrush(brushInput.value));
  }
  if (brushSlider) {
    brushSlider.value = String(brushSize);
    brushSlider.addEventListener('input', () => setBrush(brushSlider.value));
    brushSlider.addEventListener('change', () => setBrush(brushSlider.value));
  }
  if (heightBrushInput) {
    heightBrushInput.value = brushSize;
    heightBrushInput.addEventListener('input', () => setBrush(heightBrushInput.value));
    heightBrushInput.addEventListener('change', () => setBrush(heightBrushInput.value));
  }
  if (heightBrushSlider) {
    heightBrushSlider.value = String(brushSize);
    heightBrushSlider.addEventListener('input', () => setBrush(heightBrushSlider.value));
    heightBrushSlider.addEventListener('change', () => setBrush(heightBrushSlider.value));
  }

  const tileSelectBtn = document.getElementById('tileSelectBtn');
  tileApplyBtn = document.getElementById('tileApplyBtn');
  tileCancelBtn = document.getElementById('tileCancelBtn');
  const tileBrushBtn = document.getElementById('tileBrushBtn');
  const tileBrushControls = document.getElementById('tileBrushControls');
  const tileSelectControls = document.getElementById('tileSelectControls');
  const heightSelectBtn = document.getElementById('heightSelectBtn');
  heightApplyBtn = document.getElementById('heightApplyBtn');
  heightCancelBtn = document.getElementById('heightCancelBtn');
  const heightBrushBtn = document.getElementById('heightBrushBtn');
  const heightBrushControls = document.getElementById('heightBrushControls');
  const heightSelectControls = document.getElementById('heightSelectControls');
  undoBtn = document.getElementById('undoBtn');
  redoBtn = document.getElementById('redoBtn');
  if (undoBtn) undoBtn.addEventListener('click', undo);
  if (redoBtn) redoBtn.addEventListener('click', redo);
  updateUndoRedoButtons();

  window.addEventListener('keydown', (e) => {
    if (e.target && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
    const key = e.key.toLowerCase();
    if (e.ctrlKey && key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if (e.ctrlKey && ((e.shiftKey && key === 'z') || key === 'y')) {
      e.preventDefault();
      redo();
    } else if (e.code === 'Space') {
      if (activeTab === 'textures' && tileBrushMode && lastMouseEvent) {
        e.preventDefault();
        handleEditClick({
          clientX: lastMouseEvent.clientX,
          clientY: lastMouseEvent.clientY,
          shiftKey: e.shiftKey,
        });
        return;
      }
      if (activeTab === 'height' && heightBrushMode && lastMouseEvent) {
        e.preventDefault();
        handleEditClick({
          clientX: lastMouseEvent.clientX,
          clientY: lastMouseEvent.clientY,
          shiftKey: e.shiftKey,
        });
        return;
      }
      e.preventDefault();
      if (activeTab === 'height') {
        if (heightApplyBtn && !heightApplyBtn.disabled) heightApplyBtn.click();
      } else if (activeTab === 'textures') {
        if (tileApplyBtn && !tileApplyBtn.disabled) tileApplyBtn.click();
      } else if (tileApplyBtn && !tileApplyBtn.disabled) {
        tileApplyBtn.click();
      } else if (heightApplyBtn && !heightApplyBtn.disabled) {
        heightApplyBtn.click();
      }
    } else if (key === 'escape') {
      e.preventDefault();
      if (activeTab === 'height') {
        if (heightCancelBtn && !heightCancelBtn.disabled) heightCancelBtn.click();
      } else if (activeTab === 'textures') {
        if (tileCancelBtn && !tileCancelBtn.disabled) tileCancelBtn.click();
      } else if (tileCancelBtn && !tileCancelBtn.disabled) {
        tileCancelBtn.click();
      } else if (heightCancelBtn && !heightCancelBtn.disabled) {
        heightCancelBtn.click();
      }
    }
  });

    const updateTileBrushControls = () => {
      const shouldEnable = tileBrushMode && !tileSelectionMode;
      if (brushInput) {
        brushInput.disabled = !shouldEnable;
        brushInput.style.pointerEvents = shouldEnable ? 'auto' : 'none';
      }
      if (brushSlider) {
        brushSlider.disabled = !shouldEnable;
        brushSlider.style.pointerEvents = shouldEnable ? 'auto' : 'none';
      }
      if (tileBrushControls) {
        tileBrushControls.style.display = tileBrushMode ? 'flex' : 'none';
      }
    };
    const updateHeightBrushControls = () => {
      const shouldEnable = heightBrushMode && !heightSelectionMode;
      if (heightBrushInput) {
        heightBrushInput.disabled = !shouldEnable;
        heightBrushInput.style.pointerEvents = shouldEnable ? 'auto' : 'none';
      }
      if (heightBrushSlider) {
        heightBrushSlider.disabled = !shouldEnable;
        heightBrushSlider.style.pointerEvents = shouldEnable ? 'auto' : 'none';
      }
      if (heightBrushControls) {
        heightBrushControls.style.display = heightBrushMode ? 'flex' : 'none';
      }
    };
  updateTileBrushControls();
  updateHeightBrushControls();
  updateTileApplyBtn();
  updateHeightApplyBtn();

  if (tileSelectBtn) {
    tileSelectBtn.addEventListener('click', () => {
      if (tileSelectionMode) {
        tileSelectionMode = false;
        tileSelectBtn.classList.remove('active');
      } else {
        tileSelectionMode = true;
        tileSelectBtn.classList.add('active');
        tileBrushMode = false;
        if (tileBrushBtn) tileBrushBtn.classList.remove('active');
        if (showTileInfoCheckbox) {
          showTileInfoCheckbox.checked = false;
          showTileInfoCheckbox.dispatchEvent(new Event('change'));
        }
        tileSelectStart = null;
        tileSelectEnd = null;
        tileSelectionFixed = false;
        if (highlightMesh && scene) {
          scene.remove(highlightMesh);
          highlightMesh = null;
        }
      }
      updateTileBrushControls();
      updateTileApplyBtn();
      if (lastMouseEvent) updateHighlight(lastMouseEvent);
    });
  }

  if (tileBrushBtn) {
    tileBrushBtn.addEventListener('click', () => {
      if (tileBrushMode) {
        tileBrushMode = false;
        tileBrushBtn.classList.remove('active');
      } else {
        tileBrushMode = true;
        tileBrushBtn.classList.add('active');
        tileSelectionMode = false;
        if (tileSelectBtn) tileSelectBtn.classList.remove('active');
        if (showTileInfoCheckbox) {
          showTileInfoCheckbox.checked = false;
          showTileInfoCheckbox.dispatchEvent(new Event('change'));
        }
        tileSelectStart = null;
        tileSelectEnd = null;
        tileSelectionFixed = false;
        if (highlightMesh && scene) {
          scene.remove(highlightMesh);
          highlightMesh = null;
        }
      }
      updateTileBrushControls();
      updateTileApplyBtn();
      if (lastMouseEvent) updateHighlight(lastMouseEvent);
    });
  }

  if (tileShowBtn && showTileInfoCheckbox) {
    tileShowBtn.addEventListener('click', () => {
      showTileInfoCheckbox.checked = !showTileInfoCheckbox.checked;
      if (showTileInfoCheckbox.checked) {
        tileBrushMode = false;
        tileSelectionMode = false;
        if (tileBrushBtn) tileBrushBtn.classList.remove('active');
        if (tileSelectBtn) tileSelectBtn.classList.remove('active');
        tileSelectStart = null;
        tileSelectEnd = null;
        tileSelectionFixed = false;
        if (highlightMesh && scene) {
          scene.remove(highlightMesh);
          highlightMesh = null;
        }
      }
      updateTileBrushControls();
      updateTileApplyBtn();
      showTileInfoCheckbox.dispatchEvent(new Event('change'));
      if (lastMouseEvent) updateHighlight(lastMouseEvent);
    });
  }

  if (tileApplyBtn) {
    tileApplyBtn.addEventListener('click', () => {
      if (!tileSelectStart || !tileSelectEnd) return;
      const minX = Math.min(tileSelectStart.x, tileSelectEnd.x);
      const maxX = Math.max(tileSelectStart.x, tileSelectEnd.x);
      const minY = Math.min(tileSelectStart.y, tileSelectEnd.y);
      const maxY = Math.max(tileSelectStart.y, tileSelectEnd.y);
      let needsRedraw = false;
      const changes = [];
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          if (x >= 0 && x < mapW && y >= 0 && y < mapH) {
            const oldTile = mapTiles[y][x];
            const oldRot = mapRotations[y][x];
            if (oldTile !== selectedTileId || oldRot !== selectedRotation) {
              changes.push({ x, y, oldTile, oldRot, newTile: selectedTileId, newRot: selectedRotation });
              mapTiles[y][x] = selectedTileId;
              mapRotations[y][x] = selectedRotation;
              needsRedraw = true;
            }
          }
        }
      }
      if (changes.length) pushUndo({ type: 'tiles', changes });
      if (needsRedraw) drawMap3D();
      tileSelectStart = null;
      tileSelectEnd = null;
      tileSelectionFixed = false;
      if (highlightMesh && scene) {
        scene.remove(highlightMesh);
        highlightMesh = null;
      }
      updateTileApplyBtn();
    });
  }

  if (tileCancelBtn) {
    tileCancelBtn.addEventListener('click', () => {
      tileSelectStart = null;
      tileSelectEnd = null;
      tileSelectionFixed = false;
      if (highlightMesh && scene) {
        scene.remove(highlightMesh);
        highlightMesh = null;
      }
      updateTileApplyBtn();
    });
  }

  if (heightSelectBtn) {
    heightSelectBtn.addEventListener('click', () => {
      if (heightSelectionMode) {
        heightSelectionMode = false;
        heightSelectBtn.classList.remove('active');
        updateHeightBrushControls();
        heightSelectStart = null;
        heightSelectEnd = null;
        if (highlightMesh && scene) {
          scene.remove(highlightMesh);
          highlightMesh = null;
        }
      } else {
        heightSelectionMode = true;
        heightSelectBtn.classList.add('active');
        heightBrushMode = false;
        if (heightBrushBtn) heightBrushBtn.classList.remove('active');
        updateHeightBrushControls();
      }
      updateHeightApplyBtn();
      if (lastMouseEvent) updateHighlight(lastMouseEvent);
    });
  }

  if (heightBrushBtn) {
    heightBrushBtn.addEventListener('click', () => {
      if (heightBrushMode) {
        heightBrushMode = false;
        heightBrushBtn.classList.remove('active');
      } else {
        heightBrushMode = true;
        heightBrushBtn.classList.add('active');
        heightSelectionMode = false;
        if (heightSelectBtn) heightSelectBtn.classList.remove('active');
        heightSelectStart = null;
        heightSelectEnd = null;
        if (highlightMesh && scene) {
          scene.remove(highlightMesh);
          highlightMesh = null;
        }
      }
      updateHeightBrushControls();
      updateHeightApplyBtn();
      if (lastMouseEvent) updateHighlight(lastMouseEvent);
    });
  }

  if (heightApplyBtn) {
    heightApplyBtn.addEventListener('click', (ev) => {
      if (!heightSelectStart || !heightSelectEnd) return;
      let newHeight = selectedHeight;
      if (ev.shiftKey) newHeight = 0;
      const minX = Math.min(heightSelectStart.x, heightSelectEnd.x);
      const maxX = Math.max(heightSelectStart.x, heightSelectEnd.x);
      const minY = Math.min(heightSelectStart.y, heightSelectEnd.y);
      const maxY = Math.max(heightSelectStart.y, heightSelectEnd.y);
      const changes = [];
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          if (x >= 0 && x < mapW && y >= 0 && y < mapH) {
            const oldHeight = mapHeights[y][x];
            const nh = Math.max(0, Math.min(heightMax, newHeight));
            if (oldHeight !== nh) {
              changes.push({ x, y, oldHeight, newHeight: nh });
              mapHeights[y][x] = nh;
            }
          }
        }
      }
      if (changes.length) pushUndo({ type: 'height', changes });
      drawMap3D();
      heightSelectStart = null;
      heightSelectEnd = null;
      if (highlightMesh && scene) {
        scene.remove(highlightMesh);
        highlightMesh = null;
      }
      updateHeightApplyBtn();
    });
  }

  if (heightCancelBtn) {
    heightCancelBtn.addEventListener('click', () => {
      heightSelectStart = null;
      heightSelectEnd = null;
      if (highlightMesh && scene) {
        scene.remove(highlightMesh);
        highlightMesh = null;
      }
      updateHeightApplyBtn();
    });
  }

  const typeSelect = document.getElementById('tileTypeSelect');
  if (typeSelect) {
    typeSelect.addEventListener('change', () => {
      const val = parseInt(typeSelect.value, 10);
      selectedTileType = isNaN(val) ? 0 : val;
      if (tileTypesById.length > selectedTileId) {
        tileTypesById[selectedTileId] = selectedTileType;
      }
      typeSelect.style.color = TILE_TYPE_COLORS[selectedTileType % TILE_TYPE_COLORS.length] || '#888';
      renderTexturePalette();
      drawMap3D();
    });
  }
  const typeToggle = document.getElementById('displayTileTypes');
  if (typeToggle) {
    typeToggle.addEventListener('change', () => {
      renderTexturePalette();
    });
  }
  heightInput = document.getElementById('heightValueInput');
  heightSlider = document.getElementById('heightSlider');
  if (heightInput && heightSlider) {
    selectedHeight = parseInt(heightInput.value, 10) || 0;
    const syncHeightControls = (val) => {
      const clamped = Math.max(0, Math.min(heightMax, val));
      selectedHeight = clamped;
      heightInput.value = clamped;
      heightSlider.value = clamped;
    };
    heightInput.addEventListener('change', () => {
      const val = parseInt(heightInput.value, 10);
      if (!isNaN(val)) syncHeightControls(val);
    });
    heightSlider.addEventListener('input', () => {
      const val = parseInt(heightSlider.value, 10);
      syncHeightControls(val);
    });
    document.querySelectorAll('.height-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = parseInt(btn.getAttribute('data-val'), 10);
        if (!isNaN(val)) syncHeightControls(val);
      });
    });
  }
  const sizeXInput = document.getElementById('sizeXInput');
  const sizeYInput = document.getElementById('sizeYInput');
  const sizeXSlider = document.getElementById('sizeXSlider');
  const sizeYSlider = document.getElementById('sizeYSlider');
  const applySizeBtn = document.getElementById('applySizeBtn');
  const resetSizeBtn = document.getElementById('resetSizeBtn');
  if (applySizeBtn && resetSizeBtn && sizeXInput && sizeYInput && sizeXSlider && sizeYSlider) {
    const updateApplyBtn = () => {
      const w = parseInt(sizeXInput.value, 10);
      const h = parseInt(sizeYInput.value, 10);
      applySizeBtn.disabled = (w === mapW && h === mapH);
    };
    const syncX = (val) => {
      const clamped = Math.max(1, Math.min(255, val));
      sizeXInput.value = clamped;
      sizeXSlider.value = clamped;
      updateApplyBtn();
    };
    const syncY = (val) => {
      const clamped = Math.max(1, Math.min(255, val));
      sizeYInput.value = clamped;
      sizeYSlider.value = clamped;
      updateApplyBtn();
    };
    syncX(mapW);
    syncY(mapH);
    sizeXInput.addEventListener('input', () => {
      const val = parseInt(sizeXInput.value, 10);
      if (!isNaN(val)) syncX(val);
    });
    sizeXSlider.addEventListener('input', () => {
      const val = parseInt(sizeXSlider.value, 10);
      syncX(val);
    });
    sizeYInput.addEventListener('input', () => {
      const val = parseInt(sizeYInput.value, 10);
      if (!isNaN(val)) syncY(val);
    });
    sizeYSlider.addEventListener('input', () => {
      const val = parseInt(sizeYSlider.value, 10);
      syncY(val);
    });
    resetSizeBtn.addEventListener('click', () => {
      syncX(mapW);
      syncY(mapH);
    });
    applySizeBtn.addEventListener('click', () => {
      const newW = parseInt(sizeXInput.value, 10);
      const newH = parseInt(sizeYInput.value, 10);
      if (!isNaN(newW) && !isNaN(newH) && newW > 0 && newH > 0 && newW <= 255 && newH <= 255) {
        resizeMap(newW, newH);
        updateApplyBtn();
      }
    });
  }
  threeContainer.addEventListener('mousemove', handleMouseMove);
  threeContainer.addEventListener('mouseleave', () => {
    const hasHeightSelection = heightSelectionMode && heightSelectStart && heightSelectEnd;
    const hasTileSelection = tileSelectionMode && tileSelectStart && tileSelectEnd;
    if (highlightMesh && scene && !hasHeightSelection && !hasTileSelection) {
      scene.remove(highlightMesh);
      highlightMesh = null;
    }
    if (previewGroup && scene) {
      previewGroup.traverse(child => {
        if (child.isMesh) {
          if (child.material && child.material.map) child.material.map.dispose();
          if (child.material) child.material.dispose();
          if (child.geometry) child.geometry.dispose();
        }
      });
      scene.remove(previewGroup);
      previewGroup = null;
    }
    clearHoveredStructure();
  });
  setTileset(tilesetIndex);
  const structureSelect = document.getElementById('structureSelect');
  const structureFilter = document.getElementById('structureFilter');
  document.querySelectorAll('[data-structure-mode]').forEach(btn => {
    btn.addEventListener('click', () => setStructureMode(btn.getAttribute('data-structure-mode')));
  });
  updateStructureModeUI();
  const structurePlayerSelect = document.getElementById('structurePlayerSelect');
  if (structurePlayerSelect) {
    structurePlayerSelect.addEventListener('change', () => {
      if (selectedStructureGroup) setStructurePlayer(selectedStructureGroup, structurePlayerSelect.value);
    });
  }
  const structureRotationInput = document.getElementById('structureRotationInput');
  const structureViewRotateLeft = document.getElementById('structureViewRotateLeft');
  const structureViewRotateRight = document.getElementById('structureViewRotateRight');
  if (structureRotationInput) {
    const applyStructureRotationInput = () => {
      if (selectedStructureGroup) setStructureRotationDegrees(selectedStructureGroup, structureRotationInput.value);
    };
    structureRotationInput.addEventListener('input', applyStructureRotationInput);
    structureRotationInput.addEventListener('change', applyStructureRotationInput);
  }
  if (structureViewRotateLeft) {
    structureViewRotateLeft.addEventListener('click', () => {
      if (selectedStructureGroup) setStructureRotationDegrees(selectedStructureGroup, getStructureRotationDegrees(selectedStructureGroup) + 90);
    });
  }
  if (structureViewRotateRight) {
    structureViewRotateRight.addEventListener('click', () => {
      if (selectedStructureGroup) setStructureRotationDegrees(selectedStructureGroup, getStructureRotationDegrees(selectedStructureGroup) - 90);
    });
  }
  if (structureSelect) {
    structureSelect.addEventListener('change', () => {
      const val = parseInt(structureSelect.value, 10);
      selectedStructureIndex = isNaN(val) ? -1 : val;
      if (lastMouseEvent) updateHighlight(lastMouseEvent);
      selectedStructureRotation = 0;
      updateStructurePreview();
    });
  }
  if (structureFilter) {
    populateStructureFilter();
    structureFilter.addEventListener('change', () => {
      populateStructureSelect();
    });
  }
  if (structureSelect) {
    loadSensorDefs().then(() => loadStructureDefs());
  } else {
    loadSensorDefs();
  }
  const sRotLeft = document.getElementById('structRotateLeft');
  const sRotRight = document.getElementById('structRotateRight');
  if (sRotLeft) {
    sRotLeft.addEventListener('click', () => {
      selectedStructureRotation = (selectedStructureRotation + 1) % 4;
      updateStructurePreview();
      if (lastMouseEvent) updateHighlight(lastMouseEvent);
    });
  }
  if (sRotRight) {
    sRotRight.addEventListener('click', () => {
      selectedStructureRotation = (selectedStructureRotation + 3) % 4;
      updateStructurePreview();
      if (lastMouseEvent) updateHighlight(lastMouseEvent);
    });
  }
  const previewDiv = document.getElementById('structurePreview');
  if (previewDiv) {
    const width = previewDiv.clientWidth;
    const height = previewDiv.clientHeight;
    previewRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    previewRenderer.setSize(width, height);
    previewRenderer.setClearColor(0x151e28, 0);
    previewDiv.appendChild(previewRenderer.domElement);
    previewScene = new THREE.Scene();
    const ambient = new THREE.AmbientLight(0xffffff, 0.8);
    previewScene.add(ambient);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
    dirLight.position.set(10, 20, 10);
    previewScene.add(dirLight);
    previewCamera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    previewCamera.position.set(2.5, 2, 2.5);
    previewCamera.lookAt(0, 0, 0);
    const renderPreview = () => {
      if (previewRenderer && previewScene && previewCamera) {
        previewRenderer.render(previewScene, previewCamera);
      }
      requestAnimationFrame(renderPreview);
    };
    renderPreview();
    updateStructurePreview();
  }
  if (threeContainer) {
    // Use pointerdown so tile edits respond immediately on press and
    // work reliably across mouse and touch interactions.
    threeContainer.addEventListener('pointerdown', handleEditClick);
  }
};

function handleEditClick(event) {
  if (activeTab !== 'textures' && activeTab !== 'height' && activeTab !== 'objects') return;
  if (activeTab === 'objects' && structureMode !== 'build') {
    const group = pickStructureFromEvent(event);
    if (structureMode === 'view') {
      selectStructureGroup(group);
    } else if (structureMode === 'delete' && group) {
      if (removeStructureGroup(group)) {
        pushUndo({ type: 'structure-delete', group });
      }
    }
    return;
  }
  const rect = threeContainer.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(scene.children, true);
  if (!intersects.length) return;
  const point = intersects[0].point;
  const tileX = Math.floor(point.x);
  const tileY = Math.floor(point.z);
  if (tileX < 0 || tileX >= mapW || tileY < 0 || tileY >= mapH) return;
  if (activeTab === 'height' && heightSelectionMode) {
    lastMouseEvent = event;
    if (!heightSelectStart || heightSelectEnd) {
      heightSelectStart = { x: tileX, y: tileY };
      heightSelectEnd = null;
    } else {
      heightSelectEnd = { x: tileX, y: tileY };
    }
    updateHighlight(event);
    updateHeightApplyBtn();
    return;
  }
  if (activeTab === 'textures') {
    if (tileSelectionMode) {
      lastMouseEvent = event;
      if (!tileSelectStart || tileSelectionFixed) {
        tileSelectStart = { x: tileX, y: tileY };
        tileSelectEnd = { x: tileX, y: tileY };
        tileSelectionFixed = false;
      } else {
        tileSelectEnd = { x: tileX, y: tileY };
        tileSelectionFixed = true;
      }
      updateHighlight(event);
      updateTileApplyBtn();
      return;
    }
    if (!tileBrushMode) return;
    let __needsRedrawTex = false;
    const changes = [];
    for (let dy = 0; dy < brushSize; dy++) {
      for (let dx = 0; dx < brushSize; dx++) {
        const tx = tileX + dx;
        const ty = tileY + dy;
        if (tx >= 0 && tx < mapW && ty >= 0 && ty < mapH) {
          const oldTile = mapTiles[ty][tx];
          const oldRot = mapRotations[ty][tx];
          if (oldTile !== selectedTileId || oldRot !== selectedRotation) {
            changes.push({ x: tx, y: ty, oldTile, oldRot, newTile: selectedTileId, newRot: selectedRotation });
            mapTiles[ty][tx] = selectedTileId;
            mapRotations[ty][tx] = selectedRotation;
            __needsRedrawTex = true;
          }
        }
      }
    }
    if (changes.length) pushUndo({ type: 'tiles', changes });
    if (__needsRedrawTex) drawMap3D();
  } else if (activeTab === 'height' && heightBrushMode) {
    let __needsRedrawHeight = false;
    let newHeight = selectedHeight;
    if (event.shiftKey) {
      newHeight = 0;
    }
    const changes = [];
    for (let dy = 0; dy < brushSize; dy++) {
      for (let dx = 0; dx < brushSize; dx++) {
        const tx = tileX + dx;
        const ty = tileY + dy;
        if (tx >= 0 && tx < mapW && ty >= 0 && ty < mapH) {
          const oldHeight = mapHeights[ty][tx];
          const nh = Math.max(0, Math.min(heightMax, newHeight));
          if (oldHeight !== nh) {
            changes.push({ x: tx, y: ty, oldHeight, newHeight: nh });
            mapHeights[ty][tx] = nh;
            __needsRedrawHeight = true;
          }
        }
      }
    }
    if (changes.length) pushUndo({ type: 'height', changes });
    if (__needsRedrawHeight) drawMap3D();
  } else if (activeTab === 'objects') {
    if (selectedStructureIndex < 0) return;
    const def = STRUCTURE_DEFS[selectedStructureIndex];
    let sizeX = def.sizeX || 1;
    let sizeY = def.sizeY || 1;
    if (selectedStructureRotation % 2 === 1) {
      const tmp = sizeX;
      sizeX = sizeY;
      sizeY = tmp;
    }
    if (tileX + sizeX - 1 >= mapW || tileY + sizeY - 1 >= mapH) {
      setFileStatus('Cannot place structure: structure does not fit inside the map.');
      return;
    }
    const placement = getStructurePlacementValidity(def, tileX, tileY, sizeX, sizeY);
    if (!placement.valid) {
      setFileStatus('Cannot place structure: ' + placement.reason);
      updateHighlight(event);
      return;
    }
    let minH = Infinity;
    for (let dy = 0; dy < sizeY; dy++) {
      for (let dx = 0; dx < sizeX; dx++) {
        const h = mapHeights[tileY + dy][tileX + dx] * HEIGHT_SCALE;
        if (h < minH) minH = h;
      }
    }
    buildStructureGroup(def, selectedStructureRotation, sizeX, sizeY).then(group => {
      const pos = getStructurePlacementPosition(group, tileX, tileY, sizeX, sizeY, minH);
      group.position.copy(pos);
      markStructureForExport(group, def, selectedStructureRotation, sizeX, sizeY);
      objectsGroup.add(group);
      if (!scene.children.includes(objectsGroup)) scene.add(objectsGroup);
      drawMap3D();
      pushUndo({ type: 'structure', group });
      lastMouseEvent = event;
      updateHighlight(event);
    }).catch(() => {});
  }
}
function __old_updateHighlight(event) {
  if (!threeContainer || !scene) return;
  if (activeTab !== 'textures' && activeTab !== 'height' && activeTab !== 'objects') {
    if (highlightMesh) {
      scene.remove(highlightMesh);
      highlightMesh = null;
    }
    if (previewGroup) {
      previewGroup.traverse(child => {
        if (child.isMesh) {
          if (child.material && child.material.map) child.material.map.dispose();
          if (child.material) child.material.dispose();
          if (child.geometry) child.geometry.dispose();
        }
      });
      scene.remove(previewGroup);
      previewGroup = null;
    }
    return;
  }
  if (activeTab === 'height' && !heightBrushMode) {
    if (highlightMesh) {
      scene.remove(highlightMesh);
      highlightMesh = null;
    }
    return;
  }
  if (activeTab === 'textures' && !tileBrushMode) {
    if (highlightMesh) {
      scene.remove(highlightMesh);
      highlightMesh = null;
    }
    return;
  }
  let clientX, clientY;
  if (event) {
    clientX = event.clientX;
    clientY = event.clientY;
  } else {
    return;
  }
  const rect = threeContainer.getBoundingClientRect();
  mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(scene.children, true);
  if (!intersects.length) {
    if (highlightMesh) {
      scene.remove(highlightMesh);
      highlightMesh = null;
    }
    return;
  }
  const point = intersects[0].point;
  const tileX = Math.floor(point.x);
  const tileY = Math.floor(point.z);
  if (tileX < 0 || tileX >= mapW || tileY < 0 || tileY >= mapH) {
    if (highlightMesh) {
      scene.remove(highlightMesh);
      highlightMesh = null;
    }
    return;
  }
  const size = brushSize;
  if (highlightMesh) {
    scene.remove(highlightMesh);
    if (highlightMesh.geometry) highlightMesh.geometry.dispose();
    if (highlightMesh.material) highlightMesh.material.dispose();
    highlightMesh = null;
  }
  if (previewGroup) {
    previewGroup.traverse(child => {
      if (child.isMesh) {
        if (child.material && child.material.map) child.material.map.dispose();
        if (child.material) child.material.dispose();
        if (child.geometry) child.geometry.dispose();
      }
    });
    scene.remove(previewGroup);
    previewGroup = null;
  }
  if (activeTab === 'textures' || activeTab === 'height') {
    const geo = new THREE.PlaneGeometry(size, size);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.3, side: THREE.DoubleSide });
    highlightMesh = new THREE.Mesh(geo, mat);
    let maxH = 0;
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        const tx = tileX + dx;
        const ty = tileY + dy;
        if (tx >= 0 && tx < mapW && ty >= 0 && ty < mapH) {
          const h = mapHeights[ty][tx] * HEIGHT_SCALE;
          if (h > maxH) maxH = h;
        }
      }
    }
    highlightMesh.position.set(tileX + size / 2, maxH + 0.02, tileY + size / 2);
    scene.add(highlightMesh);
  } else if (activeTab === 'objects') {
    if (selectedStructureIndex < 0) return;
    const def = STRUCTURE_DEFS[selectedStructureIndex];
    let sizeX = def.sizeX || 1;
    let sizeY = def.sizeY || 1;
    if (selectedStructureRotation % 2 === 1) {
      const tmpXY = sizeX;
      sizeX = sizeY;
      sizeY = tmpXY;
    }
    let maxH2 = 0;
    for (let dy = 0; dy < sizeY; dy++) {
      for (let dx = 0; dx < sizeX; dx++) {
        const tx = tileX + dx;
        const ty = tileY + dy;
        if (tx >= 0 && tx < mapW && ty >= 0 && ty < mapH) {
          const h = mapHeights[ty][tx] * HEIGHT_SCALE;
          if (h > maxH2) maxH2 = h;
        }
      }
    }
    const newGroup = new THREE.Group();
    const planeGeo = new THREE.PlaneGeometry(sizeX, sizeY);
    planeGeo.rotateX(-Math.PI / 2);
    const planeMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.4, side: THREE.DoubleSide });
    const planeMesh = new THREE.Mesh(planeGeo, planeMat);
    planeMesh.position.set(tileX + sizeX / 2, maxH2 + 0.02, tileY + sizeY / 2);
    highlightMesh = planeMesh;
    newGroup.add(planeMesh);
    const currentToken = ++highlightLoadToken;
    const pieFile = (def.pies && def.pies.length) ? def.pies[0] : null;
    const repositionPreview = () => {
      if (!highlightModelGroup) return;
      const cX = highlightModelGroup.userData.centerX;
      const cZ = highlightModelGroup.userData.centerZ;
      const minYVal = highlightModelGroup.userData.minY;
      const pX = tileX + sizeX / 2 - cX;
      // Slightly raise preview to keep floor tiles above the terrain
      const pY = maxH2 + 0.02 - minYVal;
      const pZ = tileY + sizeY / 2 - cZ;
      highlightModelGroup.position.set(pX + cX, pY, pZ + cZ);
    };
    if (!pieFile) {
      previewGroup = newGroup;
      scene.add(previewGroup);
    } else if (highlightModelGroup && highlightCachedId === def.id && highlightCachedRot === selectedStructureRotation) {
      repositionPreview();
      previewGroup = newGroup;
      scene.add(previewGroup);
      if (!scene.children.includes(highlightModelGroup)) scene.add(highlightModelGroup);
    } else if (highlightLoadingId === def.id && highlightLoadingRot === selectedStructureRotation) {
      previewGroup = newGroup;
      scene.add(previewGroup);
    } else {
      highlightLoadingId = def.id;
      highlightLoadingRot = selectedStructureRotation;
      if (highlightModelGroup) {
        scene.remove(highlightModelGroup);
        highlightModelGroup.traverse(child => {
          if (child.isMesh) {
            if (child.material && child.material.map) child.material.map.dispose();
            if (child.material) child.material.dispose();
            if (child.geometry) child.geometry.dispose();
          }
        });
        highlightModelGroup = null;
      }
      loadPieGeometry(pieFile).then(geo => {
            if (currentToken !== highlightLoadToken) return;
        const g = geo.clone();
        g.computeBoundingBox();
        const bb = g.boundingBox;
        const width = bb.max.x - bb.min.x;
        const depth = bb.max.z - bb.min.z;
        let sX = width !== 0 ? (sizeX / width) : 1;
        let sZ = depth !== 0 ? (sizeY / depth) : 1;
        let scl = Math.min(sX, sZ);
        if (!isFinite(scl) || scl <= 0) scl = 1;
        g.scale(scl, scl, scl);
        g.computeBoundingBox();
        const bb2 = g.boundingBox;
        let baseMat;
        if (g.userData && g.userData.textureName) {
          const texLoader = new THREE.TextureLoader();
          const texName = normalizeTexPath(g.userData.textureName);
          const tex = texLoader.load(((typeof window!=='undefined'&&window.TEX_BASE)?window.TEX_BASE:TEX_BASE) +  texName, undefined, undefined, () => {});
          tex.magFilter = THREE.NearestFilter;
          tex.minFilter = THREE.LinearMipMapLinearFilter;
          baseMat = new THREE.MeshLambertMaterial({ map: tex, transparent: true, opacity: 0.5 });
        } else {
          baseMat = new THREE.MeshPhongMaterial({ color: 0x8888ff, transparent: true, opacity: 0.5 });
        }
        const cX = (bb2.min.x + bb2.max.x) / 2;
        const cY = (bb2.min.y + bb2.max.y) / 2;
        const cZ = (bb2.min.z + bb2.max.z) / 2;
        const minYVal = bb2.min.y;
        const connRel = {
          x: 0,
          y: bb2.max.y - minYVal,
          z: 0
        };
        const inner = new THREE.Group();
        const baseMesh = new THREE.Mesh(g, baseMat);
        baseMesh.position.set(-cX, -cY, -cZ);
        inner.add(baseMesh);
        let attachments = STRUCTURE_TURRETS[def.id];
        const sensorModels = getSensorModels(def.sensorID);
        if (sensorModels.length) {
          attachments = sensorModels;
        }
        let loadAtts;
        if (attachments && attachments.length) {
          const sortedFiles = attachments.slice().sort((a, b) => {
                const aTur = a.toLowerCase().startsWith('tr') ? 0 : 1;
                const bTur = b.toLowerCase().startsWith('tr') ? 0 : 1;
                return aTur - bTur;
              });
          loadAtts = Promise.all(sortedFiles.map(file => loadPieGeometry(file))).then(attGeos => {
            if (currentToken !== highlightLoadToken) return;
            const gHeightVal = bb2.max.y - bb2.min.y;
            let offYVal = gHeightVal / 2;
            attGeos.forEach(attGeo => {
              const tg = attGeo.clone();
              tg.scale(scl, scl, scl);
              tg.computeBoundingBox();
              const tb = tg.boundingBox;
              let tMat;
              if (tg.userData && tg.userData.textureName) {
                const texLoader2 = new THREE.TextureLoader();
                const texName2 = normalizeTexPath(tg.userData.textureName);
                const tex2 = texLoader2.load(((typeof window!=='undefined'&&window.TEX_BASE)?window.TEX_BASE:TEX_BASE) +  texName2, undefined, undefined, () => {});
                tex2.magFilter = THREE.NearestFilter;
                tex2.minFilter = THREE.LinearMipMapLinearFilter;
                tMat = new THREE.MeshLambertMaterial({ map: tex2, transparent: true, opacity: 0.5 });
              } else {
                tMat = new THREE.MeshLambertMaterial({ color: 0x6666ff, transparent: true, opacity: 0.5 });
              }
              const tMesh = new THREE.Mesh(tg, tMat);
              const tcX = (tb.min.x + tb.max.x) / 2;
              const tcZ = (tb.min.z + tb.max.z) / 2;
              const tMinY = tb.min.y;
              if (connRel) {
                const xPos = connRel.x - tcX;
                const yPos = connRel.y - tMinY;
                const zPos = connRel.z - tcZ;
                tMesh.position.set(xPos, yPos, zPos);
              } else {
                tMesh.position.set(-tcX, offYVal - tMinY, -tcZ);
                offYVal += (tb.max.y - tb.min.y);
              }
              inner.add(tMesh);
            });
          }).catch(() => {});
        } else {
          loadAtts = Promise.resolve();
        }
        Promise.resolve(loadAtts).then(() => {
            if (currentToken !== highlightLoadToken) return;
          const pX = tileX + sizeX / 2 - cX;
          // Slightly raise preview to keep floor tiles above the terrain
          const pY = maxH2 + 0.02 - minYVal;
          const pZ = tileY + sizeY / 2 - cZ;
          inner.position.set(pX + cX, pY, pZ + cZ);
          inner.rotation.y = -selectedStructureRotation * Math.PI / 2;
          inner.userData.centerX = cX;
          inner.userData.centerY = cY;
          inner.userData.centerZ = cZ;
          inner.userData.minY = minYVal;
          highlightModelGroup = inner;
          highlightCachedId = def.id;
          highlightCachedRot = selectedStructureRotation;
          highlightLoadingId = null;
          highlightLoadingRot = null;
          previewGroup = newGroup;
          scene.add(previewGroup);
          scene.add(highlightModelGroup);
        });
      }).catch(err => {
        console.warn('Failed to load structure preview for placement', err);
        highlightLoadingId = null;
        highlightLoadingRot = null;
        previewGroup = newGroup;
        scene.add(previewGroup);
        previewGroup.position.copy(getStructurePlacementPosition(previewGroup, tileX, tileY, sizeX, sizeY, minH));
      });
    }
  }
}
function handleMouseMove(event) {
  lastMouseEvent = event;
  updateHighlight(event);
}
function setActiveTab(tab) {
  activeTab = tab;
  window.activeTab = activeTab;
  document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
    const isActive = btn.getAttribute('data-tab') === tab;
    btn.classList.toggle('active', isActive);
  });
  const panels = document.querySelectorAll('#editPanel .panel');
  panels.forEach(p => { p.style.display = 'none'; });
  const panel = document.getElementById(tab + 'Panel');
  if (panel) panel.style.display = 'block';
  if (tab === 'objects') {
    updateStructureModeUI();
    updateStructurePreview();
  } else {
    clearHoveredStructure();
    clearSelectedStructure();
  }
}
window.setActiveTab = setActiveTab;
  function updateSelectedInfo() {
    const span = document.getElementById('selectedTileIdDisplay');
    if (span) {
      span.textContent = selectedTileId;
    }
    const rotSpan = document.getElementById('selectedRotationDisplay');
    if (rotSpan) {
      rotSpan.textContent = `${selectedRotation * 90}°`;
    }
    const typeSelect = document.getElementById('tileTypeSelect');
    if (typeSelect && tileTypesById.length) {
      const typeVal = tileTypesById[selectedTileId] ?? 0;
      typeSelect.value = typeVal;
      selectedTileType = typeVal;
    typeSelect.style.color = TILE_TYPE_COLORS[typeVal % TILE_TYPE_COLORS.length] || '#888';
  }
  // Ensure the type label prefix is present
  const typeLabel = document.getElementById('selectedTileTypeLabel');
  if (typeLabel) typeLabel.textContent = 'Type:';
  // Ensure single-line + smaller font for type label
  try {
    const _lbl = document.getElementById('selectedTileTypeLabel');
    if (_lbl) {
      _lbl.style.fontSize = '12px';
      _lbl.style.whiteSpace = 'nowrap';
    }
    const _idSpan = document.getElementById('selectedTileIdDisplay');
    const _parent = _idSpan ? _idSpan.parentElement : null;
    if (_parent) {
      _parent.style.whiteSpace = 'nowrap';
    }
  } catch(e) {}
}
function updateStructurePreview() {
  const label = document.getElementById('structureNameLabel');
  if (!previewScene || !previewRenderer || !previewCamera) {
    if (label) label.textContent = '';
    return;
  }
  const previewDiv = document.getElementById('structurePreview');
  if (previewRenderer && previewDiv) {
    const w = previewDiv.clientWidth || 160;
    const h = previewDiv.clientHeight || 160;
    if (w > 0 && h > 0) {
      previewRenderer.setSize(w, h);
      previewCamera.aspect = w / h;
      previewCamera.updateProjectionMatrix();
    }
  }
  const currentToken = ++previewLoadToken;
  if (previewScene) {
    for (let i = previewScene.children.length - 1; i >= 0; i--) {
      const child = previewScene.children[i];
      if (child.isMesh || child.type === "Group") {
        previewScene.remove(child);
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
        if (child.children) {
          child.traverse((c) => {
            if (c.geometry) c.geometry.dispose();
            if (c.material) c.material.dispose();
          });
        }
      }
    }
    previewMesh = null;
  }
  if (selectedStructureIndex < 0) {
    if (label) label.textContent = '';
    return;
  }
  const def = STRUCTURE_DEFS[selectedStructureIndex];
  if (label) label.textContent = def.name || '';
    buildStructureGroup(def, selectedStructureRotation, def.sizeX, def.sizeY, null, 1).then(group => {
  if (currentToken !== previewLoadToken) return;
  group.traverse(obj => {
    if (obj.material) obj.material.transparent = true;
  });
  previewMesh = group;
  previewScene.add(previewMesh);
  const box = new THREE.Box3().setFromObject(previewMesh);
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);
  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = previewCamera.fov * (Math.PI / 180);
  const cameraZ = (maxDim / 2) / Math.tan(fov / 2);
  const offset = cameraZ * 1.4;
  previewCamera.position.set(
    center.x + offset,
    center.y + offset,
    center.z + offset
  );
  previewCamera.lookAt(center);
  previewCamera.updateProjectionMatrix();
}).catch(() => {});
}
function renderTexturePalette() {
  const palette = document.getElementById('texturePalette');
  if (!palette) return;
  palette.innerHTML = '';
  const typeToggle = document.getElementById('displayTileTypes');
  const showTypes = typeToggle && typeToggle.checked && tileTypesById.length;
  // Use the actual number of loaded tile images rather than the
  // expected count from the tileset definition. This ensures we
  // don't accidentally clip tiles when a tileset provides more (or
  // fewer) images than the hard-coded metadata. For example the
  // Rocky Mountains tileset should display all 80 tiles.
  const total = tileImages.length;
  for (let idx = 0; idx < total; idx++) {
    const img = tileImages[idx];
    const canvas = document.createElement('canvas');
    canvas.width = TILE_ICON_SIZE;
    canvas.height = TILE_ICON_SIZE;
    const ctx = canvas.getContext('2d');
    const center = TILE_ICON_SIZE / 2;
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.save();
      ctx.translate(center, center);
        const snapped = Math.round(cameraState.rotationY / (Math.PI / 2)) * (Math.PI / 2);
        ctx.rotate(snapped - (selectedRotation * Math.PI) / 2);
      ctx.translate(-center, -center);
      ctx.drawImage(img, 0, 0, TILE_ICON_SIZE, TILE_ICON_SIZE);
      ctx.restore();
    }
    if (showTypes) {
      const typeCode = tileTypesById[idx] ?? 0;
      const colour = TILE_TYPE_COLORS[typeCode % TILE_TYPE_COLORS.length];
      ctx.fillStyle = colour;
      const dotSize = TILE_ICON_SIZE * 0.25;
      ctx.fillRect(2, 2, dotSize, dotSize);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.strokeRect(2, 2, dotSize, dotSize);
    }
    // Panel: big centered tile ID label (independent of type toggle)
    (function() {
      const el = (typeof showPanelIdsCheckbox !== 'undefined' && showPanelIdsCheckbox)
        ? showPanelIdsCheckbox
        : document.getElementById('showPanelIds');
      if (!el || el.checked) {
        const label = String(idx);
        const cx = TILE_ICON_SIZE / 2;
        const cy = TILE_ICON_SIZE / 2;
        ctx.beginPath();
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.arc(cx, cy, TILE_ICON_SIZE * 0.38, 0, Math.PI * 2);
        ctx.fill();
        const fontSize = Math.floor(TILE_ICON_SIZE * 0.55);
        ctx.font = 'bold ' + fontSize + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = Math.max(2, Math.floor(TILE_ICON_SIZE * 0.08));
        ctx.strokeStyle = 'rgba(0,0,0,0.9)';
        ctx.strokeText(label, cx, cy);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(label, cx, cy);
      }
    })();
    const imgElem = new Image();
    imgElem.src = canvas.toDataURL();
    imgElem.dataset.index = idx;
    imgElem.style.width = TILE_ICON_SIZE + 'px';
    imgElem.style.height = TILE_ICON_SIZE + 'px';
    imgElem.style.cursor = 'pointer';
    imgElem.style.border = '1px solid #435066';
    imgElem.style.boxSizing = 'border-box';
    imgElem.addEventListener('click', () => {
      selectedTileId = idx;
      updateSelectedInfo();
      palette.querySelectorAll('img').forEach(el => el.style.outline = '');
      imgElem.style.outline = '2px solid #8cf';
      if (lastMouseEvent) updateHighlight(lastMouseEvent);
    });
    imgElem.addEventListener('mouseenter', ev => showTileTooltip(ev, idx));
    imgElem.addEventListener('mousemove', moveTileTooltip);
    imgElem.addEventListener('mouseleave', hideTileTooltip);
    palette.appendChild(imgElem);
  }
  const selectedImg = palette.querySelector("img[data-index='" + selectedTileId + "']");
  if (selectedImg) {
    selectedImg.style.outline = '2px solid #8cf';
  }
}
const DEFAULT_MAP_W = 20;
const DEFAULT_MAP_H = 40;
const CAM_EDGE_MARGIN = 400;
let tilesetIndex = 0;
let mapW = DEFAULT_MAP_W, mapH = DEFAULT_MAP_H;
let mapTiles = Array(mapH).fill().map(() => Array(mapW).fill(0));
let mapHeights = Array(mapH).fill().map(() => Array(mapW).fill(0));
let mapRotations = Array(mapH).fill().map(() => Array(mapW).fill(0));
let mapXFlip = Array(mapH).fill().map(() => Array(mapW).fill(false));
let mapYFlip = Array(mapH).fill().map(() => Array(mapW).fill(false));
let mapTriFlip = Array(mapH).fill().map(() => Array(mapW).fill(false));
const TILE_TYPE_NAMES = [
  "Sand",
  "Sandy Brush",
  "Rubble",
  "Green Mud",
  "Red Brush",
  "Pink Rock",
  "Road",
  "Water",
  "Cliff Face",
  "Baked Earth",
  "Sheet Ice",
  "Slush"
];
const TILE_TYPE_CODES = [
  "TER_SAND",
  "TER_SANDYBRUSH",
  "TER_RUBBLE",
  "TER_GREENMUD",
  "TER_REDBRUSH",
  "TER_PINKROCK",
  "TER_ROAD",
  "TER_WATER",
  "TER_CLIFFFACE",
  "TER_BAKEDEARTH",
  "TER_SHEETICE",
  "TER_SLUSH"
];
// Adds a colored square before each tile type option in the dropdown.
function colorizeTileTypeOptions() {
  const sel = document.getElementById('tileTypeSelect');
  if (!sel) return;
  for (let i = 0; i < sel.options.length; i++) {
    const opt = sel.options[i];
    const baseName = opt.getAttribute('data-name') || opt.textContent.replace(/^■\s*/, '').trim();
    const color = (typeof TILE_TYPE_COLORS !== 'undefined' && TILE_TYPE_COLORS[i]) ? TILE_TYPE_COLORS[i] : '#888';
    opt.textContent = '■ ' + baseName;
    opt.style.color = color;
    // Attach a plain-text tooltip so the browser shows terrain info
    // even when the native <select> drop-down is expanded. Native
    // <option> elements do not reliably fire mouse events, so we set
    // the `title` attribute instead of custom hover handlers.
    if (terrainSpeedModifiers) {
      const terrainKey = TILE_TYPE_CODES[i];
      if (terrainKey) {
        let tooltip = `${TILE_TYPE_NAMES[i] || ''}\n`;
        tooltip += 'Speed modifiers:\n';
        for (const prop in terrainSpeedModifiers) {
          const val = terrainSpeedModifiers[prop][terrainKey];
          if (val != null) tooltip += `${prop}: ${Math.round(val * 100)}%\n`;
        }
        opt.title = tooltip.trim();
      }
    }
  }
  const idx = parseInt(sel.value, 10) || 0;
  sel.style.color = (typeof TILE_TYPE_COLORS !== 'undefined' && TILE_TYPE_COLORS[idx]) ? TILE_TYPE_COLORS[idx] : '#888';
}
  let terrainSpeedModifiers = null;
  let tileTooltipDiv = null;
  let selectedTileType = 0;
  function parseTileTypes(data) {
  if (!data || data.length < 12) return [];
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const entryCount = dv.getUint32(8, true);
  const arr = [];
  for (let i = 0; i < entryCount; i++) {
    const val = dv.getUint16(12 + i * 2, true);
    arr.push(val);
  }
  return arr;
}

async function loadTerrainSpeedModifiers() {
  try {
    const resp = await fetch('terrain_speed_modifiers.json', { cache: 'no-cache' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    terrainSpeedModifiers = await resp.json();
  } catch (err) {
    console.error('Failed to load terrain speed modifiers:', err);
  }
}

function ensureTileTooltip() {
  if (tileTooltipDiv) return;
  tileTooltipDiv = document.createElement('div');
  tileTooltipDiv.style.position = 'fixed';
  tileTooltipDiv.style.pointerEvents = 'none';
  tileTooltipDiv.style.background = 'rgba(24,32,48,0.95)';
  tileTooltipDiv.style.border = '1px solid #435066';
  tileTooltipDiv.style.padding = '4px';
  tileTooltipDiv.style.fontSize = '12px';
  tileTooltipDiv.style.zIndex = '200';
  tileTooltipDiv.style.display = 'none';
  document.body.appendChild(tileTooltipDiv);
}

function showTileTooltip(ev, idx, isTypeIndex = false) {
  if (!terrainSpeedModifiers) return;
  let typeCode;
  if (isTypeIndex) {
    typeCode = idx;
  } else {
    if (!tileTypesById.length) return;
    typeCode = tileTypesById[idx] ?? 0;
  }
  const terrainKey = TILE_TYPE_CODES[typeCode];
  if (!terrainKey) return;
  let html = `<b>${TILE_TYPE_NAMES[typeCode] || ''}</b><br>`;
  html += 'Speed modifiers:<br>';
  for (const prop in terrainSpeedModifiers) {
    const val = terrainSpeedModifiers[prop][terrainKey];
    if (val != null) html += `${prop}: ${Math.round(val * 100)}%<br>`;
  }
  ensureTileTooltip();
  tileTooltipDiv.innerHTML = html;
  tileTooltipDiv.style.display = 'block';
  moveTileTooltip(ev);
}

function moveTileTooltip(ev) {
  if (!tileTooltipDiv) return;
  tileTooltipDiv.style.left = (ev.clientX + 12) + 'px';
  tileTooltipDiv.style.top = (ev.clientY + 12) + 'px';
}

function hideTileTooltip() {
  if (tileTooltipDiv) tileTooltipDiv.style.display = 'none';
}
TILESETS.forEach((ts, i) => {
  let opt = document.createElement("option");
  opt.value = i;
  opt.textContent = ts.name;
  tilesetSelect.appendChild(opt);
});
tilesetSelect.value = tilesetIndex;
if (tilesetSelect && !tilesetSelect.__wzBound) {
  tilesetSelect.addEventListener('change', (e) => {
    const idx = parseInt(e.target.value, 10);
    setTileset(isNaN(idx) ? 0 : idx);
  });
  tilesetSelect.addEventListener('input', (e) => {
    const idx = parseInt(e.target.value, 10);
    setTileset(isNaN(idx) ? 0 : idx);
  });
  tilesetSelect.__wzBound = true;
}
setupKeyboard(() => resetCameraTarget(mapW, mapH, threeContainer));
async function setTileset(idx) {
  // ensure fresh tiles when switching sets
  clearTileCache(idx);

  if (idx < 0 || idx >= TILESETS.length) idx = 0;
  tilesetIndex = idx;
  tilesetSelect.value = tilesetIndex;
  tileImages = await loadAllTiles(tilesetIndex);
  renderTexturePalette();
  updateSelectedInfo();
  drawMap3D();
}

async function loadStructuresFromZip(zip) {
  if (objectsGroup) objectsGroup.clear();
  const structName = Object.keys(zip.files).find(fn => fn.toLowerCase().endsWith('struct.json') && !zip.files[fn].dir);
  currentStructArchivePath = structName || null;
  currentStructJsonStyle = 'array';
  if (!structName) return;
  try {
    const text = await zip.files[structName].async('string');
    const data = JSON.parse(text);
    currentStructJsonStyle = Array.isArray(data) || Array.isArray(data.structures) ? 'array' : 'object';
    if (!STRUCTURE_DEFS.length) {
      try { await loadStructureDefs(); } catch (e) {}
    }
    const entries = Array.isArray(data) ? data : Array.isArray(data.structures) ? data.structures : Object.values(data);
    const promises = entries.map(entry => {
      const name = typeof entry.name === 'string' ? entry.name.toLowerCase() : null;
      if (!name) return Promise.resolve();
      const def = STRUCTURE_DEFS.find(d => d.id.toLowerCase() === name);
      if (!def) return Promise.resolve();
      let rot = 0;
      let rotDeg = 0;
      if (Array.isArray(entry.rotation)) {
        const yaw = entry.rotation.find(v => typeof v === 'number' && v !== 0) ?? entry.rotation[0] ?? 0;
        rotDeg = Math.abs(yaw) > 360 ? yaw * 360 / 65536 : yaw;
        rot = Math.round(rotDeg / 90) % 4;
      } else if (typeof entry.rotation === 'number') {
        rotDeg = Math.abs(entry.rotation) > 360 ? entry.rotation * 360 / 65536 : entry.rotation;
        rot = Math.round(rotDeg / 90) % 4;
      }
      rot = ((rot % 4) + 4) % 4;
      rotDeg = normalizeDegrees(rotDeg);
      let sizeX = def.sizeX || 1;
      let sizeY = def.sizeY || 1;
      if (rot % 2 === 1) {
        const tmp = sizeX; sizeX = sizeY; sizeY = tmp;
      }
      const centerX = (entry.position?.[0] || 0) / 128;
      const centerY = (entry.position?.[1] || 0) / 128;
      const tileX = Math.round(centerX - sizeX / 2);
      const tileY = Math.round(centerY - sizeY / 2);
      if (tileX < 0 || tileY < 0 || tileX >= mapW || tileY >= mapH) return Promise.resolve();
      let minH = Infinity;
      for (let dy = 0; dy < sizeY; dy++) {
        for (let dx = 0; dx < sizeX; dx++) {
          if (tileY + dy < 0 || tileY + dy >= mapH || tileX + dx < 0 || tileX + dx >= mapW) continue;
          const h = mapHeights[tileY + dy][tileX + dx] * HEIGHT_SCALE;
          if (h < minH) minH = h;
        }
      }
      return buildStructureGroup(def, rot, sizeX, sizeY).then(group => {
        const pos = getStructurePlacementPosition(group, tileX, tileY, sizeX, sizeY, minH);
        group.position.copy(pos);
        markStructureForExport(group, def, rot, sizeX, sizeY, entry, currentStructJsonStyle);
        setStructureRotationDegrees(group, rotDeg);
        objectsGroup.add(group);
      }).catch(() => {});
    });
    await Promise.all(promises);
  } catch (err) {
    console.error('Failed to load structures from struct.json:', err);
  }
}

async function loadDroidsFromZip(zip) {
  const droidName = Object.keys(zip.files).find(fn => fn.toLowerCase().endsWith('droid.json') && !zip.files[fn].dir);
  if (!droidName) return;
  try {
    await loadComponentDefs();
    const text = await zip.files[droidName].async('string');
    const data = JSON.parse(text);
    const entries = Array.isArray(data) ? data : Array.isArray(data.droids) ? data.droids : Object.values(data);
    for (const entry of entries) {
      if (entry.template && templateDefs && templateDefs[entry.template]) {
        const t = templateDefs[entry.template];
        entry.body ||= t.body;
        entry.propulsion ||= t.propulsion;
        if (!entry.weapon && !entry.weapons) {
          if (Array.isArray(t.weapons)) entry.weapons = t.weapons.slice();
          else if (t.weapon) entry.weapon = t.weapon;
        }
      }
      const posX = (entry.position?.[0] ?? 0) / 128;
      const posZ = (entry.position?.[1] ?? 0) / 128;
      const tileX = Math.floor(posX);
      const tileY = Math.floor(posZ);
      if (tileX < 0 || tileY < 0 || tileX >= mapW || tileY >= mapH) continue;
      // Lift droids slightly above the terrain to avoid z-fighting
      const h = (mapHeights?.[tileY]?.[tileX] ?? 0) * HEIGHT_SCALE + 0.07;
      const yaw = (entry.rotation?.[1] ?? 0) * (2 * Math.PI / 65536);
      const pieList = (() => {
        if (Array.isArray(entry.pies)) return entry.pies;
        if (Array.isArray(entry.models)) return entry.models;
        if (entry.pie) return [entry.pie];
        if (entry.model) return [entry.model];
        const parts = [];
        const toPath = (val, prefix = '') => {
          let name = String(val);
          if (!name.toLowerCase().endsWith('.pie')) name += '.pie';
          if (name.includes('/')) return name;
          return prefix + name;
        };
        const addPart = (val, prefix) => {
          if (!val) return;
          if (Array.isArray(val)) val.forEach(v => parts.push(toPath(v, prefix)));
          else parts.push(toPath(val, prefix));
        };
        const addWeapon = val => {
          if (!val) return;
          const wd = weaponDefs && weaponDefs[val];
          if (wd) {
            const modelPath = wd.model && toPath(wd.model, 'components/weapons/');
            const mountPath = wd.mountModel && toPath(wd.mountModel, 'components/weapons/');
            if (modelPath) parts.push(modelPath);
            if (mountPath && mountPath !== modelPath) parts.push(mountPath);
          } else {
            addPart(val, 'components/weapons/');
          }
        };
        const bodyId = entry.body;
        const propId = entry.propulsion;
        if (bodyId) {
          const bd = bodyDefs && bodyDefs[bodyId];
          if (bd && bd.model) addPart(bd.model, 'components/bodies/');
          else addPart(bodyId, 'components/bodies/');
          if (bd && bd.propulsionExtraModels && propId) {
            const extra = bd.propulsionExtraModels[propId];
            if (extra) {
              if (typeof extra === 'string') addPart(extra, 'components/prop/');
              else Object.values(extra).forEach(v => addPart(v, 'components/prop/'));
            }
          }
        }
        if (propId) {
          const pd = propDefs && propDefs[propId];
          if (pd && pd.model) addPart(pd.model, 'components/prop/');
          else addPart(propId, 'components/prop/');
        }
        const weapons = entry.weapon || entry.weapons;
        if (Array.isArray(weapons)) weapons.forEach(addWeapon);
        else addWeapon(weapons);
        return parts.length ? parts : null;
      })();
      if (pieList && pieList.length) {
        try {
          const group = await buildDroidGroup(pieList);
          const cX = group.userData.centerX || 0;
          const cZ = group.userData.centerZ || 0;
          const minY = group.userData.minY || 0;
          group.position.set(posX - cX, h - minY, posZ - cZ);
          group.rotation.y = -yaw;
          objectsGroup.add(group);
          continue;
        } catch (e) {
          console.warn('Failed to build droid from pies:', e);
        }
      }
      const geom = new THREE.ConeGeometry(0.3, 0.6, 4);
      const color = PLAYER_COLORS[(entry.startpos ?? 0) % PLAYER_COLORS.length];
      const mat = new THREE.MeshLambertMaterial({ color });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.rotation.y = -yaw;
      mesh.position.set(posX, h, posZ);
      mesh.userData.cullable = true;
      objectsGroup.add(mesh);
    }
    if (objectsGroup && !scene.children.includes(objectsGroup)) {
      scene.add(objectsGroup);
    }
  } catch (err) {
    console.error('Failed to load droids from droid.json:', err);
  }
}

async function loadMapFile(file) {
  fileListDiv.classList.add('hidden');
  infoDiv.textContent = "";
  if (mapFilenameSpan) mapFilenameSpan.textContent = file.name;
  setLoadingProgress('Preparing ' + file.name, 2);
  try {
    const inputEl = document.getElementById('wzLoader');
    if (inputEl) inputEl.style.display = 'none';
    if (mapFilenameSpan) mapFilenameSpan.style.display = 'none';
    if (typeof uiBar !== 'undefined' && uiBar) uiBar.style.display = 'none';
    try {
      const threeEl = document.getElementById('threeContainer');
      if (threeEl) { threeEl.style.top = '0px'; threeEl.style.height = '100vh'; }
      const overlayEl = document.getElementById('overlayMsg');
      if (overlayEl) overlayEl.style.top = '0px';
    } catch(e) {}
  } catch(e) {}
  let fileExt = file.name.toLowerCase().split('.').pop();
  currentMapArchive = null;
  currentMapArchivePath = null;
  currentMapExportInfo = null;
  currentStructArchivePath = null;
  currentStructJsonStyle = 'array';
  let found = false;
  let autoTs = 0;
  if (fileExt === 'map' || fileExt === 'json') {
    setLoadingProgress('Reading map file', 15);
    if (fileExt === 'json') {
      try {
        const json = JSON.parse(await file.text());
        if (typeof json.tileset === 'number') autoTs = json.tileset;
      } catch (e) {}
    } else {
      currentMapExportInfo = getMapExportInfo(new Uint8Array(await file.arrayBuffer()));
    }
    setLoadingProgress('Parsing map grid', 35);
    const mapData = await loadMapUnified(file);
    console.log("Loaded map format:", mapData.format, mapData);
    setLoadingProgress('Loading tileset textures', 55);
    await setTileset(autoTs);
    setLoadingProgress('Applying map data', 70);
    mapW = mapData.mapW;
    mapH = mapData.mapH;
    mapTiles = mapData.mapTiles;
    mapRotations = mapData.mapRotations;
    mapHeights = mapData.mapHeights;
    mapXFlip = mapData.mapXFlip || mapXFlip;
    mapYFlip = mapData.mapYFlip || mapYFlip;
    mapTriFlip = mapData.mapTriFlip || mapTriFlip;
    updateHeightUI(mapData.mapVersion >= 39 ? 1023 : 255);
    resetCameraTarget(mapW, mapH, threeContainer);
    infoDiv.innerHTML = '<b>Loaded map grid:</b> <span style="color:yellow">' + file.name + '</span><br>Tileset: ' + TILESETS[tilesetIndex].name + '<br>Size: ' + mapW + 'x' + mapH;
    setFileStatus('Loaded ' + file.name);
    setLoadingProgress('Drawing map', 95);
    drawMap3D();
    setLoadingProgress('Map loaded', 100);
    setTimeout(hideLoadingProgress, 600);
    hideOverlay();
    return;
  }
  try {
    setLoadingProgress('Reading archive file', 20);
    const buf = await file.arrayBuffer();
    setLoadingProgress('Opening map archive', 30);
    const zip = await JSZip.loadAsync(buf);
    let names = Object.keys(zip.files).map(n => n.replace(/\\/g, '/'));
    const ttypesName = names.find(n => n.toLowerCase().endsWith('ttypes.ttp'));
    let ttypesMap = null;
    if (ttypesName) {
      setLoadingProgress('Loading tile type metadata', 38);
      const ttypesData = await zip.files[ttypesName].async('uint8array');
      ttypesMap = parseTTypes(ttypesData);
    }
    setLoadingProgress('Detecting tileset', 44);
    autoTs = await getTilesetIndexFromTtp(zip, TTP_TILESET_MAP);
    let allMapNames = Object.keys(zip.files)
      .filter(fname => fname.toLowerCase().endsWith(".map") && !zip.files[fname].dir);
    let mapFileName = allMapNames.find(f => f.toLowerCase().endsWith("game.map")) || allMapNames[0];
    if (mapFileName) {
      currentMapArchive = zip;
      currentMapArchivePath = mapFileName;
      setLoadingProgress('Extracting map grid', 50);
      let fileData = await zip.files[mapFileName].async("uint8array");
      currentMapExportInfo = getMapExportInfo(fileData);
      setLoadingProgress('Converting map grid if needed', 56);
      const converted = convertGammaGameMapToClassic(fileData, ttypesMap);
      if (converted) fileData = converted;
      setLoadingProgress('Loading tileset textures', 62);
      await setTileset(autoTs);
      setLoadingProgress('Parsing map grid', 68);
      const result = await loadMapUnified(new File([fileData], mapFileName));
      console.log("Loaded map format:", result.format, result);
      if (result) {
        setLoadingProgress('Applying map data', 74);
        mapW = result.mapW;
        mapH = result.mapH;
        mapTiles = result.mapTiles;
        mapRotations = result.mapRotations;
        mapHeights = result.mapHeights;
        mapXFlip = result.mapXFlip || mapXFlip;
        mapYFlip = result.mapYFlip || mapYFlip;
        mapTriFlip = result.mapTriFlip || mapTriFlip;
        updateHeightUI(result.mapVersion >= 39 ? 1023 : 255);
        const ttpName = Object.keys(zip.files).find(fn => fn.toLowerCase().endsWith('.ttp') && !zip.files[fn].dir);
        if (ttpName) {
          setLoadingProgress('Loading tile type metadata', 80);
          const ttpData = await zip.files[ttpName].async('uint8array');
          tileTypesById = parseTileTypes(ttpData);
          if (tileTypesById.length < tileImages.length) {
            for (let i = tileTypesById.length; i < tileImages.length; i++) tileTypesById[i] = 0;
          }
        } else {
          tileTypesById = new Array(tileImages.length).fill(0);
        }
        setLoadingProgress('Loading structures', 86);
        await loadStructuresFromZip(zip);
        setLoadingProgress('Loading droids', 91);
        await loadDroidsFromZip(zip);
        resetCameraTarget(mapW, mapH, threeContainer);
        infoDiv.innerHTML = '<b>Loaded map grid:</b> <span style="color:yellow">' + mapFileName + '</span><br>Tileset: ' + TILESETS[tilesetIndex].name + '<br>Size: ' + mapW + 'x' + mapH;
        setFileStatus('Loaded ' + file.name);
        setLoadingProgress('Drawing map', 96);
        drawMap3D();
        setLoadingProgress('Map loaded', 100);
        setTimeout(hideLoadingProgress, 600);
        hideOverlay();
        found = true;
        const typeSelect = document.getElementById('tileTypeSelect');
        if (typeSelect) {
          if (!typeSelect.options.length) {
            TILE_TYPE_NAMES.forEach((name, idx) => {
              const opt = document.createElement('option');
              opt.value = idx;
              opt.textContent = name;
              typeSelect.appendChild(opt);
            });
                      try{colorizeTileTypeOptions();}catch(e){}
}
          if (tileTypesById.length > selectedTileId) {
            typeSelect.value = tileTypesById[selectedTileId] ?? 0;
          } else {
            typeSelect.value = 0;
          }
          const idx = parseInt(typeSelect.value, 10) || 0;
          typeSelect.style.color = TILE_TYPE_COLORS[idx % TILE_TYPE_COLORS.length] || '#888';
        }
        renderTexturePalette();
        const sizeXInputEl = document.getElementById('sizeXInput');
        const sizeYInputEl = document.getElementById('sizeYInput');
        const sizeXSliderEl = document.getElementById('sizeXSlider');
        const sizeYSliderEl = document.getElementById('sizeYSlider');
        if (sizeXInputEl) sizeXInputEl.value = mapW;
        if (sizeYInputEl) sizeYInputEl.value = mapH;
        if (sizeXSliderEl) sizeXSliderEl.value = mapW;
        if (sizeYSliderEl) sizeYSliderEl.value = mapH;
      }
    }
    if (!found) {
      infoDiv.innerHTML = '<b style=\"color:red\">Failed to decode any map grid in this archive!</b>';
      setLoadingProgress('Failed to decode map grid', 100);
      showOverlay("Failed to load map. Please select another file.");
      resetCameraTarget(mapW, mapH, threeContainer);
    }
  } catch (err) {
    infoDiv.innerHTML = '<b style=\"color:red\">Failed to open archive!</b>';
    setLoadingProgress('Failed to open map archive', 100);
    showOverlay("Failed to open file. Please select another map.");
    resetCameraTarget(mapW, mapH, threeContainer);
  }
}

document.getElementById('wzLoader').addEventListener('change', async evt => {
  const file = evt.target.files[0];
  if (!file) return;
  await loadMapFile(file);
});

async function fetchBlobWithProgress(url, label, options = undefined) {
  setLoadingProgress('Downloading ' + label, 3);
  const resp = await fetch(url, options);
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const total = parseInt(resp.headers.get('content-length') || '0', 10);
  if (!resp.body || !total) {
    const blob = await resp.blob();
    setLoadingProgress('Downloaded ' + label, 20);
    return blob;
  }
  const reader = resp.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    setLoadingProgress('Downloading ' + label, 3 + (received / total) * 17);
  }
  setLoadingProgress('Downloaded ' + label, 20);
  return new Blob(chunks);
}

async function loadServerMap(filename) {
  try {
    const blob = await fetchBlobWithProgress('maps/' + filename, filename);
    const file = new File([blob], filename);
    await loadMapFile(file);
  } catch (err) {
    infoDiv.innerHTML = '<b style="color:red">Failed to load server map!</b>';
    setLoadingProgress('Failed to download server map', 100);
    console.error(err);
  }
}
window.loadServerMap = loadServerMap;

function resolveMapUrl(url) {
  try {
    const u = new URL(url);
    if (
      u.hostname === 'github.com' &&
      /^\/[^/]+\/[^/]+\/releases\/download\//.test(u.pathname)
    ) {
      // Release assets aren't available on raw.githubusercontent.com.
      // Use the original GitHub release URL so the file downloads correctly.
      return u.href;
    }
  } catch (e) {
    console.error(e);
  }
  return url;
}

async function loadRemoteMap(url) {
  try {
    url = resolveMapUrl(url);
    const name = url.split('/').pop() || 'remote.wz';
    const blob = await fetchBlobWithProgress(url, name, { mode: 'cors' });
    const file = new File([blob], name);
    await loadMapFile(file);
  } catch (err) {
    infoDiv.innerHTML = '<b style="color:red">Failed to load remote map!</b>';
    setLoadingProgress('Failed to download remote map', 100);
    console.error(err);
  }
}
window.loadRemoteMap = loadRemoteMap;
loadAllTiles(tilesetIndex).then(images => {
  tileImages = images;
  showOverlay("Please select map");
  resetCameraTarget(mapW, mapH, threeContainer);
});
let isDragging = false, lastX = 0, lastY = 0;
const HEIGHT_SCALE = 0.015;
// Culling settings (added 2025-08-16)
const ENABLE_DISTANCE_CULLING = true;
const CULL_DISTANCE = 350; // world units
const ENABLE_FRUSTUM_CULLING = true;
function drawMap3D() {
  if (!threeContainer) return;
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
  if (scene && mesh) {
    scene.remove(mesh);
    mesh = null;
  }
  if (scene) {
    for (let i = scene.children.length - 1; i >= 0; --i) {
      const obj = scene.children[i];
      if (obj.type === "Mesh" || obj.type === "InstancedMesh") {
        scene.remove(obj);
        if (Array.isArray(obj.material)) {
          obj.material.forEach(mat => {
            if (mat && mat.map && typeof mat.map.dispose === "function") mat.map.dispose();
            if (mat && typeof mat.dispose === "function") mat.dispose();
          });
        } else if (obj.material) {
          if (obj.material.map && typeof obj.material.map.dispose === "function") obj.material.map.dispose();
          if (typeof obj.material.dispose === "function") obj.material.dispose();
        }
        if (obj.geometry && typeof obj.geometry.dispose === "function") obj.geometry.dispose();
      }
    }
  } else {
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setClearColor(0x151e28);
    threeContainer.appendChild(renderer.domElement);
    scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.93));
    let dir = new THREE.DirectionalLight(0xffffff, 0.7);
    dir.position.set(100, 200, 150);
    scene.add(dir);
    camera = new THREE.PerspectiveCamera(
      55,
      threeContainer.offsetWidth / threeContainer.offsetHeight,
      0.1,
      4000
    );
    camera.layers.enable(1);
    window.addEventListener('resize', () => {
      renderer.setSize(threeContainer.offsetWidth, threeContainer.offsetHeight);
      camera.aspect = threeContainer.offsetWidth / threeContainer.offsetHeight;
      camera.updateProjectionMatrix();
      resetCameraTarget(mapW, mapH, threeContainer);
    });
    threeContainer.addEventListener('mousedown', e => {
      if (activeTab === 'textures' && (tileBrushMode || tileSelectionMode)) return;
      isDragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
    });
    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        renderTexturePalette();
      }
    });
    window.addEventListener('mousemove', e => {
      if (!isDragging) return;
      let dx = e.clientX - lastX, dy = e.clientY - lastY;
      cameraState.rotationY -= dx * 0.008;
      cameraState.rotationX -= dy * 0.008;
      cameraState.rotationX = Math.max(-1.1, Math.min(-0.08, cameraState.rotationX));
      lastX = e.clientX; lastY = e.clientY;
    });
    threeContainer.addEventListener('wheel', e => {
      cameraState.zoom *= (1 + e.deltaY * 0.0015);
      cameraState.zoom = Math.max(0.01, Math.min(cameraState.zoom, 6));
    });
  }
  renderer.setSize(threeContainer.offsetWidth, threeContainer.offsetHeight);
  const showTileId = !!(typeof showTileIdCheckbox !== "undefined" && showTileIdCheckbox && showTileIdCheckbox.checked);
  const uniqueTiles = new Map();
  for (let y = 0; y < mapH; ++y) {
    for (let x = 0; x < mapW; ++x) {
      const tileIdx = mapTiles[y][x];
      const hVal = mapHeights[y][x];
      const key = showHeight ? `${tileIdx}_${hVal}` : String(tileIdx);
      if (!uniqueTiles.has(key)) {
        uniqueTiles.set(key, { tileIdx, height: hVal, positions: [] });
      }
      uniqueTiles.get(key).positions.push({ x, y, h: hVal });
    }
  }
  const tileGeometry = new THREE.BoxGeometry(1, 1, 1);
  uniqueTiles.forEach(({ tileIdx, height: heightVal, positions }) => {
    const img = tileImages[tileIdx];
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, 0, 0, 32, 32);
    } else {
      ctx.fillStyle = '#393';
      ctx.fillRect(0, 0, 32, 32);
    }
// --- draw small type swatch on map when enabled ---
try {
  if (typeof showTileTypesOnMapCheckbox !== 'undefined' && showTileTypesOnMapCheckbox && showTileTypesOnMapCheckbox.checked) {
    const typeCode = (typeof tileTypesById !== 'undefined' && tileTypesById.length) ? (tileTypesById[tileIdx] ?? 0) : 0;
    const col = (typeof TILE_TYPE_COLORS !== 'undefined' && TILE_TYPE_COLORS[typeCode % TILE_TYPE_COLORS.length]) ? TILE_TYPE_COLORS[typeCode % TILE_TYPE_COLORS.length] : '#888';
    ctx.fillStyle = col;
    const d = 6; ctx.fillRect(2, 2, d, d);
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.strokeRect(2, 2, d, d);
  }
} catch(e) {}
      if (showTileId) {
        ctx.save();
        ctx.font = "bold 14px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.strokeStyle = "#000";
        ctx.lineWidth = 2;
        ctx.strokeText(tileIdx, 16, 0);
        ctx.fillStyle = "#FFF";
        ctx.fillText(tileIdx, 16, 0);
        ctx.restore();
      }
      if (showHeight) {
        ctx.save();
        ctx.font = "bold 14px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.strokeStyle = "#000";
        ctx.lineWidth = 2;
        ctx.strokeText(heightVal, 16, 32);
        ctx.fillStyle = "#FFF";
        ctx.fillText(heightVal, 16, 32);
        ctx.restore();
      }
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.LinearMipMapLinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    const material = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
    const instancedMesh = new THREE.InstancedMesh(tileGeometry, material, positions.length);
    positions.forEach((pos, i) => {
      const h = Math.max(pos.h * HEIGHT_SCALE, 0.01);
      const rotation = -(mapRotations[pos.y][pos.x] % 4) * Math.PI / 2;
      const flipX = mapXFlip[pos.y][pos.x] ? -1 : 1;
      const flipZ = mapYFlip[pos.y][pos.x] ? -1 : 1;
      const matrix = new THREE.Matrix4();
      const rotationMatrix = new THREE.Matrix4().makeRotationY(rotation);
      const scaleMatrix = new THREE.Matrix4().makeScale(flipX, h, flipZ);
      const translationMatrix = new THREE.Matrix4().makeTranslation(pos.x + 0.5, h / 2, pos.y + 0.5);
      matrix.multiply(translationMatrix).multiply(rotationMatrix).multiply(scaleMatrix);
      instancedMesh.setMatrixAt(i, matrix);
    });
    instancedMesh.instanceMatrix.needsUpdate = true;
    scene.add(instancedMesh);
  });
  if (objectsGroup && !scene.children.includes(objectsGroup)) {
    scene.add(objectsGroup);
  }
// --- Frustum & distance culling (added 2025-08-16) ---
const __frustum = new THREE.Frustum();
const __projScreenMatrix = new THREE.Matrix4();
const __tmpVec3 = new THREE.Vector3();
function updateCulling() {
  if ((!ENABLE_DISTANCE_CULLING && !ENABLE_FRUSTUM_CULLING) || !camera || !scene) return;
  if (ENABLE_FRUSTUM_CULLING) {
    __projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    __frustum.setFromProjectionMatrix(__projScreenMatrix);
  }
  const camPos = camera.position;
  scene.traverse(obj => {
    const ud = obj.userData || {};
    if (!ud.cullable) return;
    // Start visible by default
    let visible = true;
    if (ENABLE_DISTANCE_CULLING) {
      obj.getWorldPosition(__tmpVec3);
      const dist = __tmpVec3.distanceTo(camPos);
      if (dist > CULL_DISTANCE) visible = false;
    }
    if (visible && ENABLE_FRUSTUM_CULLING) {
      let bs = ud.boundingSphere;
      if (!bs) {
        // compute once and store
        const box = new THREE.Box3().setFromObject(obj);
        const sphere = new THREE.Sphere();
        box.getBoundingSphere(sphere);
        ud.boundingSphere = sphere;
        obj.userData = ud;
        bs = sphere;
      }
      if (bs) {
        // transform sphere center to world
        const worldCenter = obj.localToWorld(bs.center.clone());
        const worldSphere = new THREE.Sphere(worldCenter, bs.radius);
        visible = __frustum.intersectsSphere(worldSphere);
      }
    }
    obj.visible = visible;
  });
}
  function animate() {
    let moveX = 0, moveZ = 0;
    if (cameraState.keys['w']) moveZ -= cameraState.camMoveSpeed * cameraState.zoom;
    if (cameraState.keys['s']) moveZ += cameraState.camMoveSpeed * cameraState.zoom;
    if (cameraState.keys['a']) moveX -= cameraState.camMoveSpeed * cameraState.zoom;
    if (cameraState.keys['d']) moveX += cameraState.camMoveSpeed * cameraState.zoom;
    if (cameraState.keys['arrowup']) moveZ -= cameraState.camMoveSpeed * cameraState.zoom;
    if (cameraState.keys['arrowdown']) moveZ += cameraState.camMoveSpeed * cameraState.zoom;
    if (cameraState.keys['arrowleft']) moveX -= cameraState.camMoveSpeed * cameraState.zoom;
    if (cameraState.keys['arrowright']) moveX += cameraState.camMoveSpeed * cameraState.zoom;
    if (moveX || moveZ) {
      const angle = cameraState.rotationY;
      const fx = Math.sin(angle);
      const fz = Math.cos(angle);
      const rx = Math.sin(angle + Math.PI / 2);
      const rz = Math.cos(angle + Math.PI / 2);
      cameraState.camTargetX += fx * moveZ + rx * moveX;
      cameraState.camTargetZ += fz * moveZ + rz * moveX;
      cameraState.camTargetX = Math.max(-CAM_EDGE_MARGIN, Math.min(mapW - 1 + CAM_EDGE_MARGIN, cameraState.camTargetX));
      cameraState.camTargetZ = Math.max(-CAM_EDGE_MARGIN, Math.min(mapH - 1 + CAM_EDGE_MARGIN, cameraState.camTargetZ));
    }
    let dist = Math.max(mapW, mapH) * 1.5 * cameraState.zoom;
    let camY = Math.abs(Math.sin(cameraState.rotationX)) * dist + 3;
    camera.position.x = cameraState.camTargetX + Math.sin(cameraState.rotationY) * Math.cos(cameraState.rotationX) * dist;
    camera.position.y = camY;
    camera.position.z = cameraState.camTargetZ + Math.cos(cameraState.rotationY) * Math.cos(cameraState.rotationX) * dist;
    camera.lookAt(cameraState.camTargetX, 0, cameraState.camTargetZ);
    if (compassNeedle) {
      const deg = -cameraState.rotationY * 180 / Math.PI;
      compassNeedle.setAttribute('transform', `rotate(${deg} 50 50)`);
    }
    updateCulling();
    renderer.render(scene, camera);
    animationId = requestAnimationFrame(animate);
  }
  animate();
}
if (showTileIdCheckbox) showTileIdCheckbox.addEventListener('change', () => drawMap3D());
if (showTileTypesOnMapCheckbox) showTileTypesOnMapCheckbox.addEventListener('change', () => drawMap3D());
if (showTileTypesCheckbox) showTileTypesCheckbox.addEventListener('change', () => {
  try {
    const pal = document.getElementById('displayTileTypes');
    if (pal) pal.checked = !!showTileTypesCheckbox.checked;
    // if tiles.js exposed palette refresh, call it; otherwise drawMap3D is enough
    if (typeof window.refreshTexturePalette === 'function') window.refreshTexturePalette();
  } catch(e) {}
  drawMap3D();
});
function resizeMap(newW, newH) {
  if (newW === mapW && newH === mapH) return;
  const oldState = {
    w: mapW,
    h: mapH,
    tiles: mapTiles,
    rotations: mapRotations,
    heights: mapHeights,
    xflip: mapXFlip,
    yflip: mapYFlip,
    triflip: mapTriFlip
  };
  const newTiles = Array(newH).fill().map(() => Array(newW).fill(0));
  const newRotationsArr = Array(newH).fill().map(() => Array(newW).fill(0));
  const newHeightsArr = Array(newH).fill().map(() => Array(newW).fill(0));
  const newXFlipArr = Array(newH).fill().map(() => Array(newW).fill(false));
  const newYFlipArr = Array(newH).fill().map(() => Array(newW).fill(false));
  const newTriFlipArr = Array(newH).fill().map(() => Array(newW).fill(false));
  for (let y = 0; y < newH; y++) {
    for (let x = 0; x < newW; x++) {
      if (y < oldState.h && x < oldState.w) {
        newTiles[y][x] = mapTiles[y][x];
        newRotationsArr[y][x] = mapRotations[y][x];
        newHeightsArr[y][x] = mapHeights[y][x];
        newXFlipArr[y][x] = mapXFlip[y][x];
        newYFlipArr[y][x] = mapYFlip[y][x];
        newTriFlipArr[y][x] = mapTriFlip[y][x];
      }
    }
  }
  const newState = {
    w: newW,
    h: newH,
    tiles: newTiles,
    rotations: newRotationsArr,
    heights: newHeightsArr,
    xflip: newXFlipArr,
    yflip: newYFlipArr,
    triflip: newTriFlipArr
  };
  setMapState(newW, newH, newTiles, newRotationsArr, newHeightsArr, newXFlipArr, newYFlipArr, newTriFlipArr);
  pushUndo({ type: 'resize', oldState, newState });
}

async function newMap() {
  currentMapArchive = null;
  currentMapArchivePath = null;
  currentMapExportInfo = null;
  currentStructArchivePath = null;
  currentStructJsonStyle = 'array';
  await setTileset(0);
  const w = DEFAULT_MAP_W;
  const h = DEFAULT_MAP_H;
  const tiles = Array(h).fill().map(() => Array(w).fill(0));
  const rotations = Array(h).fill().map(() => Array(w).fill(0));
  const heights = Array(h).fill().map(() => Array(w).fill(0));
  const xflip = Array(h).fill().map(() => Array(w).fill(false));
  const yflip = Array(h).fill().map(() => Array(w).fill(false));
  const triflip = Array(h).fill().map(() => Array(w).fill(false));
  clearMapObjects();
  setMapState(w, h, tiles, rotations, heights, xflip, yflip, triflip);
  undoStack.length = 0;
  redoStack.length = 0;
  updateUndoRedoButtons();
}
window.newMap = newMap;

function getStructurePlacementPosition(group, tileX, tileY, sizeX, sizeY, minH) {
  const centerX = group.userData.centerX;
  const centerZ = group.userData.centerZ;
  const posX = tileX + sizeX / 2 - centerX;
  // Offset slightly so structure floors render above the terrain
  const posY = minH + 0.02 - group.userData.minY;
  const posZ = tileY + sizeY / 2 - centerZ;
  return new THREE.Vector3(posX, posY, posZ);
}
// --- Repatch: unified objects preview using buildStructureGroup (2025-08-19) ---
function updateHighlight(event) {
  if (activeTab === 'height' && heightSelectionMode) {
    if (!threeContainer || !scene) return;
    let startX, startY, endX, endY;
    if (heightSelectStart && heightSelectEnd) {
      startX = heightSelectStart.x;
      startY = heightSelectStart.y;
      endX = heightSelectEnd.x;
      endY = heightSelectEnd.y;
    } else {
      if (!event) return;
      const rect = threeContainer.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(scene.children, true);
      if (!intersects.length) {
        if (highlightMesh) {
          scene.remove(highlightMesh);
          highlightMesh = null;
        }
        return;
      }
      const p = intersects[0].point;
      const tileX = Math.floor(p.x);
      const tileY = Math.floor(p.z);
      if (tileX < 0 || tileX >= mapW || tileY < 0 || tileY >= mapH) {
        if (highlightMesh) {
          scene.remove(highlightMesh);
          highlightMesh = null;
        }
        return;
      }
      if (heightSelectStart) {
        startX = heightSelectStart.x;
        startY = heightSelectStart.y;
        endX = tileX;
        endY = tileY;
      } else {
        startX = tileX;
        startY = tileY;
        endX = tileX;
        endY = tileY;
      }
    }
    const minX = Math.min(startX, endX);
    const maxX = Math.max(startX, endX);
    const minY = Math.min(startY, endY);
    const maxY = Math.max(startY, endY);
    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    if (highlightMesh) {
      scene.remove(highlightMesh);
      if (highlightMesh.geometry) highlightMesh.geometry.dispose();
      if (highlightMesh.material) highlightMesh.material.dispose();
      highlightMesh = null;
    }
    const geo = new THREE.PlaneGeometry(width, height);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.3, side: THREE.DoubleSide });
    highlightMesh = new THREE.Mesh(geo, mat);
    let maxH = 0;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const h = mapHeights[y][x] * HEIGHT_SCALE;
        if (h > maxH) maxH = h;
      }
    }
    highlightMesh.position.set(minX + width / 2, maxH + 0.02, minY + height / 2);
    scene.add(highlightMesh);
    updateHeightApplyBtn();
    return;
  }
  if (activeTab === 'textures' && tileSelectionMode) {
    if (!threeContainer || !scene) return;
    let startX, startY, endX, endY;
    if (tileSelectStart) {
      if (!tileSelectionFixed && event) {
        const rect = threeContainer.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(scene.children, true);
        if (!intersects.length) {
          if (highlightMesh) {
            scene.remove(highlightMesh);
            highlightMesh = null;
          }
          return;
        }
        const p = intersects[0].point;
        const tileX = Math.floor(p.x);
        const tileY = Math.floor(p.z);
        if (tileX < 0 || tileX >= mapW || tileY < 0 || tileY >= mapH) {
          if (highlightMesh) {
            scene.remove(highlightMesh);
            highlightMesh = null;
          }
          return;
        }
        tileSelectEnd = { x: tileX, y: tileY };
      }
      startX = tileSelectStart.x;
      startY = tileSelectStart.y;
      endX = tileSelectEnd ? tileSelectEnd.x : tileSelectStart.x;
      endY = tileSelectEnd ? tileSelectEnd.y : tileSelectStart.y;
    } else {
      if (!event) return;
      const rect = threeContainer.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(scene.children, true);
      if (!intersects.length) {
        if (highlightMesh) {
          scene.remove(highlightMesh);
          highlightMesh = null;
        }
        return;
      }
      const p = intersects[0].point;
      const tileX = Math.floor(p.x);
      const tileY = Math.floor(p.z);
      if (tileX < 0 || tileX >= mapW || tileY < 0 || tileY >= mapH) {
        if (highlightMesh) {
          scene.remove(highlightMesh);
          highlightMesh = null;
        }
        return;
      }
      startX = tileX;
      startY = tileY;
      endX = tileX;
      endY = tileY;
    }
    const minX = Math.min(startX, endX);
    const maxX = Math.max(startX, endX);
    const minY = Math.min(startY, endY);
    const maxY = Math.max(startY, endY);
    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    if (highlightMesh) {
      scene.remove(highlightMesh);
      if (highlightMesh.geometry) highlightMesh.geometry.dispose();
      if (highlightMesh.material) highlightMesh.material.dispose();
      highlightMesh = null;
    }
    const geo = new THREE.PlaneGeometry(width, height);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.3, side: THREE.DoubleSide });
    highlightMesh = new THREE.Mesh(geo, mat);
    let maxH = 0;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const h = mapHeights[y][x] * HEIGHT_SCALE;
        if (h > maxH) maxH = h;
      }
    }
    highlightMesh.position.set(minX + width / 2, maxH + 0.02, minY + height / 2);
    scene.add(highlightMesh);
    updateTileApplyBtn();
    return;
  }
  // For other textures/height/object behavior
  if (activeTab !== 'objects') {
    return __old_updateHighlight(event);
  }
  if (!threeContainer || !scene) return;
  if (activeTab !== 'objects') return;
  if (structureMode !== 'build') {
    clearStructurePlacementPreview();
    setHoveredStructure(event ? pickStructureFromEvent(event) : null);
    return;
  }
  clearHoveredStructure();
  // Read mouse
  let clientX, clientY;
  if (event) {
    clientX = event.clientX;
    clientY = event.clientY;
  } else {
    return;
  }
  const rect = threeContainer.getBoundingClientRect();
  mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(scene.children, true);
  if (!intersects.length) {
    if (highlightMesh) {
      scene.remove(highlightMesh);
      highlightMesh = null;
    }
    if (previewGroup) {
      previewGroup.traverse(child => {
        if (child.isMesh) {
          if (child.material && child.material.map) child.material.map.dispose();
          if (child.material) child.material.dispose();
          if (child.geometry) child.geometry.dispose();
        }
      });
      scene.remove(previewGroup);
      previewGroup = null;
    }
    if (highlightModelGroup) {
      scene.remove(highlightModelGroup);
      highlightModelGroup.traverse(child => {
        if (child.isMesh) {
          if (child.material && child.material.map) child.material.map.dispose();
          if (child.material) child.material.dispose();
          if (child.geometry) child.geometry.dispose();
        }
      });
      highlightModelGroup = null;
    }
    return;
  }
  const point = intersects[0].point;
  const tileX = Math.floor(point.x);
  const tileY = Math.floor(point.z);
  if (tileX < 0 || tileX >= mapW || tileY < 0 || tileY >= mapH) {
    if (highlightMesh) {
      scene.remove(highlightMesh);
      highlightMesh = null;
    }
    if (previewGroup) {
      previewGroup.traverse(child => {
        if (child.isMesh) {
          if (child.material && child.material.map) child.material.map.dispose();
          if (child.material) child.material.dispose();
          if (child.geometry) child.geometry.dispose();
        }
      });
      scene.remove(previewGroup);
      previewGroup = null;
    }
    if (highlightModelGroup) {
      scene.remove(highlightModelGroup);
      highlightModelGroup.traverse(child => {
        if (child.isMesh) {
          if (child.material && child.material.map) child.material.map.dispose();
          if (child.material) child.material.dispose();
          if (child.geometry) child.geometry.dispose();
        }
      });
      highlightModelGroup = null;
    }
    return;
  }
  if (selectedStructureIndex < 0 || !STRUCTURE_DEFS || !STRUCTURE_DEFS.length) {
    return;
  }
  const def = STRUCTURE_DEFS[selectedStructureIndex];
  let sizeX = def.sizeX || 1;
  let sizeY = def.sizeY || 1;
  if (selectedStructureRotation % 2 === 1) {
    const tmpXY = sizeX;
    sizeX = sizeY;
    sizeY = tmpXY;
  }
  const placement = getStructurePlacementValidity(def, tileX, tileY, sizeX, sizeY);
  // Ground plane highlight (green)
  let maxH2 = 0;
  let minH2 = Infinity;
  for (let dy = 0; dy < sizeY; dy++) {
    for (let dx = 0; dx < sizeX; dx++) {
      const tx = tileX + dx;
      const ty = tileY + dy;
      if (tx >= 0 && tx < mapW && ty >= 0 && ty < mapH) {
        const h = mapHeights[ty][tx] * HEIGHT_SCALE;
        if (h > maxH2) maxH2 = h;
        if (h < minH2) minH2 = h;
      }
    }
  }
  if (highlightMesh) {
    scene.remove(highlightMesh);
    if (highlightMesh.geometry) highlightMesh.geometry.dispose();
    if (highlightMesh.material) highlightMesh.material.dispose();
    highlightMesh = null;
  }
  if (previewGroup) {
    previewGroup.traverse(child => {
      if (child.isMesh) {
        if (child.material && child.material.map) child.material.map.dispose();
        if (child.material) child.material.dispose();
        if (child.geometry) child.geometry.dispose();
      }
    });
    scene.remove(previewGroup);
    previewGroup = null;
  }
  previewGroup = new THREE.Group();
  const planeGeo = new THREE.PlaneGeometry(sizeX, sizeY);
  planeGeo.rotateX(-Math.PI / 2);
  const planeMat = new THREE.MeshBasicMaterial({ color: placement.valid ? 0x00ff00 : 0xff3333, transparent: true, opacity: 0.45, side: THREE.DoubleSide });
  const planeMesh = new THREE.Mesh(planeGeo, planeMat);
  planeMesh.position.set(tileX + sizeX / 2, maxH2 + 0.02, tileY + sizeY / 2);
  highlightMesh = planeMesh;
  previewGroup.add(planeMesh);
  previewGroup.traverse(obj => obj.layers.set(1));
  scene.add(previewGroup);
  // Clear old model preview
  if (highlightModelGroup) {
    scene.remove(highlightModelGroup);
    highlightModelGroup.traverse(child => {
      if (child.isMesh) {
        if (child.material && child.material.map) child.material.map.dispose();
        if (child.material) child.material.dispose();
        if (child.geometry) child.geometry.dispose();
      }
    });
    highlightModelGroup = null;
  }
  const thisToken = ++highlightLoadToken;
  // Build unified preview using the same function as final placement
  buildStructureGroup(def, selectedStructureRotation, sizeX, sizeY, null, 0.55)
    .then(group => {
      if (thisToken !== highlightLoadToken) return; // stale
      // Use the same placement logic as for final structures to keep
      // preview alignment consistent. Compute the base position using
      // the structure's center and minY, then nudge it slightly upward
      // to avoid z-fighting with the ground.
      const baseH = isFinite(minH2) ? minH2 : 0;
      const pos = getStructurePlacementPosition(group, tileX, tileY, sizeX, sizeY, baseH);
      pos.y += 0.02;
      group.position.copy(pos);
      tintPlacementPreview(group, placement.valid);
      group.traverse(obj => obj.layers.set(1));
      scene.add(group);
      highlightModelGroup = group;
      highlightCachedId = def.id;
      highlightCachedRot = selectedStructureRotation;
    })
    .catch(err => {
      console.warn("Unified preview failed:", err);
    });
}
// Ensure "Tile" row uses smaller font size and stays in one line
(function(){
  try {
    const idSpan = document.getElementById('selectedTileIdDisplay');
    const parent = idSpan ? idSpan.parentElement : null;
    if (parent) {
      parent.style.whiteSpace = 'nowrap';
      parent.style.fontSize = '12px';
      // also tighten the number span a bit
      idSpan.style.fontSize = '12px';
    }
  } catch(e) {}
})();

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initDom);
} else {
  initDom();
}
