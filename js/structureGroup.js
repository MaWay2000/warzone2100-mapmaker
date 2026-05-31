import * as THREE from "./three.module.js";
import { loadPieGeometry } from "./pie.js";
import { STRUCTURE_TURRETS } from "./structure_turrets.js";
import { getSensorModels } from "./sensors.js";

function normalizeTexPath(name) {
  let n = String(name || "").replace(/\\/g, "/").toLowerCase();
  n = n.replace(/^\.+\//, "");
  n = n.replace(/^(images|texpages)\//, "");
  n = n.replace(/^classic\/texpages\//, "");
  n = n.replace(/texpages\/texpages\//g, "texpages/");
  return n;
}

const PLAYER_COLORS = [
  0xff0000, 0x0000ff, 0x00ff00, 0xffff00, 0xff00ff,
  0x00ffff, 0xffffff, 0x888888, 0xff8800, 0x0088ff
];
const TEAM_MASK_PAGES = new Set(['page-10', 'page-11', 'page-14', 'page-15', 'page-16', 'page-17']);

function getTeamMaskPath(textureName) {
  const match = normalizeTexPath(textureName).match(/^(page-\d+)(?:-[^/]*)?\.png$/);
  return match && TEAM_MASK_PAGES.has(match[1]) ? match[1] + '_tcmask.png' : null;
}

function createPieMaterial(textureName, opacityOverride, teamColorEnabled = false) {
  const transparent = opacityOverride !== null;
  const opacity = transparent ? opacityOverride : 1;
  if (!textureName) return new THREE.MeshLambertMaterial({ color: 0x8888ff, transparent, opacity });
  const loader = new THREE.TextureLoader();
  const texName = normalizeTexPath(textureName);
  const tex = loader.load(((typeof window!=='undefined'&&window.TEX_BASE)?window.TEX_BASE:TEX_BASE) + texName, undefined, undefined, () => {});
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipMapLinearFilter;
  const material = new THREE.MeshLambertMaterial({ map: tex, transparent, opacity });
  if (!teamColorEnabled) return material;
  const maskName = getTeamMaskPath(texName);
  const mask = maskName
    ? loader.load(((typeof window!=='undefined'&&window.TEX_BASE)?window.TEX_BASE:TEX_BASE) + maskName, undefined, undefined, () => {})
    : null;
  if (mask) {
    mask.magFilter = THREE.NearestFilter;
    mask.minFilter = THREE.LinearMipMapLinearFilter;
  }
  material.userData.teamColor = new THREE.Color(PLAYER_COLORS[0]);
  material.userData.teamColorMask = mask;
  material.onBeforeCompile = shader => {
    shader.uniforms.teamColor = { value: material.userData.teamColor };
    if (mask) shader.uniforms.teamColorMask = { value: mask };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <map_pars_fragment>', '#include <map_pars_fragment>\nuniform vec3 teamColor;' + (mask ? '\nuniform sampler2D teamColorMask;' : ''))
      .replace('#include <map_fragment>', '#include <map_fragment>\n#ifdef USE_MAP\n  vec3 teamDiffuse = texture2D(map, vUv).rgb;\n  float blueMarker = smoothstep(0.025, 0.25, teamDiffuse.b - max(teamDiffuse.r, teamDiffuse.g));\n  float teamMask = ' + (mask ? 'max(texture2D(teamColorMask, vUv).r, blueMarker)' : 'blueMarker') + ';\n  float visibleTeamMask = smoothstep(0.02, 0.6, teamMask);\n  diffuseColor.rgb = mix(diffuseColor.rgb, teamColor, visibleTeamMask * 0.55);\n#endif');
  };
  return material;
}

export function setStructureGroupPlayerColor(group, player) {
  const color = new THREE.Color(PLAYER_COLORS[Math.max(0, Math.min(9, parseInt(player, 10) || 0))]);
  group?.traverse(child => {
    if (!child.isMesh || !child.material?.userData?.teamColor) return;
    child.material.userData.teamColor.copy(color);
    child.material.needsUpdate = true;
  });
}

export async function buildStructureGroup(def, rotation, sizeX, sizeY, scaleOverride = null, opacityOverride = null) {
  const baseW = sizeX || 1;
  const baseD = sizeY || 1;
  const group = new THREE.Group();

  let connRel = null;
  let scl = scaleOverride !== null ? scaleOverride : 1;
  let minYVal = 0;

  if (def && def.pies && def.pies.length) {
    try {
      const baseGeo = await loadPieGeometry(def.pies[0]).then(g => g.clone());
      baseGeo.computeBoundingBox();
      const bb = baseGeo.boundingBox;
      const width = bb.max.x - bb.min.x || 1;
      const depth = bb.max.z - bb.min.z || 1;
      scl = scaleOverride !== null ? scaleOverride : 1;
      if (!isFinite(scl) || scl <= 0) scl = 1;
      baseGeo.scale(scl, scl, scl);
      baseGeo.computeBoundingBox();
      const bb2 = baseGeo.boundingBox;
      const cX = (bb2.min.x + bb2.max.x) / 2;
      const cY = (bb2.min.y + bb2.max.y) / 2;
      const cZ = (bb2.min.z + bb2.max.z) / 2;
      minYVal = bb2.min.y;
      let baseMat;
      if (baseGeo.userData && baseGeo.userData.textureName) {
        baseMat = createPieMaterial(baseGeo.userData.textureName, opacityOverride, baseGeo.userData.teamColorMask);
      } else {
        baseMat = new THREE.MeshLambertMaterial({ color: 0x8888ff, transparent: opacityOverride !== null, opacity: opacityOverride !== null ? opacityOverride : 1 });
      }
      const baseMesh = new THREE.Mesh(baseGeo, baseMat);
      // Anchor the base of the model at y = 0 so optional floor models
      // remain at ground level instead of hovering halfway up the structure.
      baseMesh.position.set(-cX, -bb2.min.y, -cZ);
      group.add(baseMesh);

      const alignExtrasByOrigin = !!def.alignPiesByOrigin;
      const extraPies = def.type === 'WALL' ? [] : def.pies.slice(1);
      for (const extra of extraPies) {
        try {
          const extraGeo = await loadPieGeometry(extra).then(g => g.clone());
          extraGeo.scale(scl, scl, scl);
          extraGeo.computeBoundingBox();
          const tb = extraGeo.boundingBox;
          const ecX = (tb.min.x + tb.max.x) / 2;
          const ecY = (tb.min.y + tb.max.y) / 2;
          const ecZ = (tb.min.z + tb.max.z) / 2;
          let extraMat;
          if (extraGeo.userData && extraGeo.userData.textureName) {
            extraMat = createPieMaterial(extraGeo.userData.textureName, opacityOverride, extraGeo.userData.teamColorMask);
          } else {
            extraMat = new THREE.MeshLambertMaterial({ color: 0x8888ff, transparent: opacityOverride !== null, opacity: opacityOverride !== null ? opacityOverride : 1 });
          }
          const extraMesh = new THREE.Mesh(extraGeo, extraMat);
          // Some structures have a separate floor/base PIE and a main PIE
          // authored in the same coordinate space. Keep those offsets.
          if (alignExtrasByOrigin) extraMesh.position.set(-cX, -tb.min.y, -cZ);
          else extraMesh.position.set(-ecX, -tb.min.y, -ecZ);
          group.add(extraMesh);
        } catch (_) {}
      }

      const connector = baseGeo.userData.connectors?.[0];
      connRel = connector
        ? {
            x: connector[0] * scl - cX,
            y: connector[2] * scl - minYVal,
            z: connector[1] * scl - cZ
          }
        : { x: 0, y: bb2.max.y - minYVal, z: 0 };
    } catch (e) {
      console.warn('Failed to build structure from pies:', e);
    }
  }

  if (!connRel) {
    const baseH = 0.6;
    const topW = baseW * 0.6;
    const topD = baseD * 0.6;
    const topH = baseH * 0.5;
    const baseMat = new THREE.MeshLambertMaterial({
      color: 0x8888ff,
      transparent: opacityOverride !== null,
      opacity: opacityOverride !== null ? opacityOverride : 1
    });
    const topMat = new THREE.MeshLambertMaterial({
      color: 0xa0a0a0,
      transparent: opacityOverride !== null,
      opacity: opacityOverride !== null ? opacityOverride : 1
    });
    const baseMesh = new THREE.Mesh(new THREE.BoxGeometry(baseW, baseH, baseD), baseMat);
    baseMesh.position.set(0, baseH / 2, 0);
    const topMesh = new THREE.Mesh(new THREE.BoxGeometry(topW, topH, topD), topMat);
    topMesh.position.set(0, baseH + topH / 2, 0);
    group.add(baseMesh);
    group.add(topMesh);
    connRel = { x: 0, y: baseH + topH, z: 0 };
    minYVal = 0;
  }

  let attachments = STRUCTURE_TURRETS[def.id];
  const sensorModels = getSensorModels(def.sensorID);
  if (sensorModels.length) {
    attachments = sensorModels;
  }
  if (attachments && attachments.length) {
    const sortedFiles = attachments.slice().sort((a, b) => {
      const aTur = a.toLowerCase().startsWith('tr') ? 0 : 1;
      const bTur = b.toLowerCase().startsWith('tr') ? 0 : 1;
      return aTur - bTur;
    });
    const attGeos = await Promise.all(sortedFiles.map(f => loadPieGeometry(f).then(g => g.clone()).catch(() => null)));
    let gHeightVal = connRel.y;
    let offYVal = gHeightVal / 2;
    attGeos.forEach(attGeo => {
      if (!attGeo) return;
      attGeo.scale(scl, scl, scl);
      attGeo.computeBoundingBox();
      const tb = attGeo.boundingBox;
      let tMat;
      if (attGeo.userData && attGeo.userData.textureName) {
        tMat = createPieMaterial(attGeo.userData.textureName, opacityOverride, attGeo.userData.teamColorMask);
      } else {
        tMat = new THREE.MeshLambertMaterial({ color: 0xff0000, transparent: opacityOverride !== null, opacity: opacityOverride !== null ? opacityOverride : 1 });
      }
      const tMesh = new THREE.Mesh(attGeo, tMat);
      if (connRel) {
        // Structure weapon and sensor PIEs are authored relative to the
        // structure connector. Preserve those local offsets so mounts and
        // barrels remain assembled as intended.
        tMesh.position.set(connRel.x, connRel.y, connRel.z);
      } else {
        const tcX = (tb.min.x + tb.max.x) / 2;
        const tcZ = (tb.min.z + tb.max.z) / 2;
        const tMinY = tb.min.y;
        tMesh.position.set(-tcX, offYVal - tMinY, -tcZ);
        offYVal += (tb.max.y - tb.min.y);
      }
      group.add(tMesh);
    });
  }

  group.rotation.y = -rotation * Math.PI / 2;
  group.updateMatrixWorld(true);
  let bbox = new THREE.Box3().setFromObject(group);
  const minY = bbox.min.y;
  group.userData.minY = minY;
  if (minY !== 0) {
    group.position.y -= minY;
    group.updateMatrixWorld(true);
    bbox = new THREE.Box3().setFromObject(group);
  }
  const center = bbox.getCenter(new THREE.Vector3());
  group.userData.centerX = center.x;
  group.userData.centerY = center.y;
  group.userData.centerZ = center.z;
  const __sphere = new THREE.Sphere();
  bbox.getBoundingSphere(__sphere);
  group.userData.boundingSphere = __sphere;
  group.userData.cullable = true;
  group.userData.structureId = def.id;
  return group;
}
