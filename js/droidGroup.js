import * as THREE from "./three.module.js";
import { loadPieGeometry } from "./pie.js";

function normalizeTexPath(name) {
  let n = String(name || "").replace(/\\/g, "/").toLowerCase();
  n = n.replace(/^\.+\//, "");
  n = n.replace(/^(images|texpages)\//, "");
  n = n.replace(/^classic\/texpages\//, "");
  n = n.replace(/texpages\/texpages\//g, "texpages/");
  return n;
}

function makeDroidMaterial(geo) {
  if (geo.userData && geo.userData.textureName) {
    const tl = new THREE.TextureLoader();
    const tn = normalizeTexPath(geo.userData.textureName);
    const tex = tl.load(((typeof window !== 'undefined' && window.TEX_BASE) ? window.TEX_BASE : TEX_BASE) + tn, undefined, undefined, () => {});
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.LinearMipMapLinearFilter;
    return new THREE.MeshLambertMaterial({ map: tex });
  }
  return new THREE.MeshLambertMaterial({ color: 0x8888ff });
}

function getConnectorVector(connectors, index = 0) {
  const c = connectors && connectors[index];
  return c ? new THREE.Vector3(c[0], c[1], c[2]) : null;
}

export async function buildDroidGroup(pieFiles) {
  const group = new THREE.Group();
  const parts = pieFiles.map(part => typeof part === 'string' ? { path: part, role: 'part' } : part);
  const loadedParts = await Promise.all(
    parts.map(part => loadPieGeometry(part.path).then(g => ({ ...part, geo: g.clone() })).catch(() => null))
  );
  const bodyPart = loadedParts.find(part => part && part.role === 'body');
  const bodyConnector = bodyPart ? getConnectorVector(bodyPart.geo.userData.connectors, 0) : null;
  loadedParts.forEach(part => {
    if (!part || !part.geo) return;
    const geo = part.geo;
    geo.computeBoundingBox();
    const mesh = new THREE.Mesh(geo, makeDroidMaterial(geo));
    if ((part.role === 'mount' || part.role === 'weapon') && bodyConnector) {
      mesh.position.copy(bodyConnector);
    }
    group.add(mesh);
  });
  group.updateMatrixWorld(true);
  const bbox = new THREE.Box3().setFromObject(group);
  group.userData.minY = bbox.min.y;
  const center = bbox.getCenter(new THREE.Vector3());
  group.userData.centerX = center.x;
  group.userData.centerY = center.y;
  group.userData.centerZ = center.z;
  const sphere = new THREE.Sphere();
  bbox.getBoundingSphere(sphere);
  group.userData.boundingSphere = sphere;
  group.userData.cullable = true;
  return group;
}
