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
      scl = scaleOverride !== null ? scaleOverride : Math.min(baseW / width, baseD / depth);
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
        const texLoader = new THREE.TextureLoader();
        const texName = normalizeTexPath(baseGeo.userData.textureName);
        const tex = texLoader.load(((typeof window!=='undefined'&&window.TEX_BASE)?window.TEX_BASE:TEX_BASE) + texName, undefined, undefined, () => {});
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.LinearMipMapLinearFilter;
        baseMat = new THREE.MeshLambertMaterial({ map: tex, transparent: opacityOverride !== null, opacity: opacityOverride !== null ? opacityOverride : 1 });
      } else {
        baseMat = new THREE.MeshLambertMaterial({ color: 0x8888ff, transparent: opacityOverride !== null, opacity: opacityOverride !== null ? opacityOverride : 1 });
      }
      const baseMesh = new THREE.Mesh(baseGeo, baseMat);
      // Anchor the base of the model at y = 0 so optional floor models
      // remain at ground level instead of hovering halfway up the structure.
      baseMesh.position.set(-cX, -bb2.min.y, -cZ);
      group.add(baseMesh);

      for (const extra of def.pies.slice(1)) {
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
            const tl = new THREE.TextureLoader();
            const tn = normalizeTexPath(extraGeo.userData.textureName);
            const tex2 = tl.load(((typeof window!=='undefined'&&window.TEX_BASE)?window.TEX_BASE:TEX_BASE) + tn, undefined, undefined, () => {});
            tex2.magFilter = THREE.NearestFilter;
            tex2.minFilter = THREE.LinearMipMapLinearFilter;
            extraMat = new THREE.MeshLambertMaterial({ map: tex2, transparent: opacityOverride !== null, opacity: opacityOverride !== null ? opacityOverride : 1 });
          } else {
            extraMat = new THREE.MeshLambertMaterial({ color: 0x8888ff, transparent: opacityOverride !== null, opacity: opacityOverride !== null ? opacityOverride : 1 });
          }
          const extraMesh = new THREE.Mesh(extraGeo, extraMat);
          // Position extras so their lowest point sits on the floor as well.
          extraMesh.position.set(-ecX, -tb.min.y, -ecZ);
          group.add(extraMesh);
        } catch (_) {}
      }

      connRel = { x: 0, y: bb2.max.y - minYVal, z: 0 };
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
      const tcX = (tb.min.x + tb.max.x) / 2;
      const tcZ = (tb.min.z + tb.max.z) / 2;
      const tMinY = tb.min.y;
      let tMat;
      if (attGeo.userData && attGeo.userData.textureName) {
        const tl = new THREE.TextureLoader();
        const tn = normalizeTexPath(attGeo.userData.textureName);
        const tex = tl.load(((typeof window!=='undefined'&&window.TEX_BASE)?window.TEX_BASE:TEX_BASE) + tn, undefined, undefined, () => {});
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.LinearMipMapLinearFilter;
        tMat = new THREE.MeshLambertMaterial({ map: tex, transparent: opacityOverride !== null, opacity: opacityOverride !== null ? opacityOverride : 1 });
      } else {
        tMat = new THREE.MeshLambertMaterial({ color: 0xff0000, transparent: opacityOverride !== null, opacity: opacityOverride !== null ? opacityOverride : 1 });
      }
      const tMesh = new THREE.Mesh(attGeo, tMat);
      if (connRel) {
        const xPos = connRel.x - tcX;
        const yPos = connRel.y - tMinY;
        const zPos = connRel.z - tcZ;
        tMesh.position.set(xPos, yPos, zPos);
      } else {
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
