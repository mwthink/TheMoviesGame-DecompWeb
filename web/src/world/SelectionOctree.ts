import "@babylonjs/core/Culling/Octrees/octreeSceneComponent"; // side effect: adds Scene.createOrUpdateSelectionOctree
import type { Octree } from "@babylonjs/core/Culling/Octrees/octree";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";

/**
 * Puts the meshes that never move (the placed objects: instances with a frozen world matrix) into a selection octree, so each frame Babylon tests only the blocks the
 * camera can see instead of every mesh. Everything else (people, flags, the sky, the ground, anything made later) goes in the octree's dynamic list, which is tested
 * every frame as before, so a mesh that moves or appears is never missed. Call once the world is built; meshes added afterwards are kept dynamic.
 */
export function buildSelectionOctree(scene: Scene): Octree<AbstractMesh> {
  const octree = scene.createOrUpdateSelectionOctree(64, 2);
  const isStatic = (m: AbstractMesh) => m.isWorldMatrixFrozen && m.getClassName() === "InstancedMesh";
  const statics = scene.meshes.filter(isStatic);
  const staticSet = new Set<AbstractMesh>(statics);
  // createOrUpdateSelectionOctree filed every mesh in the blocks: start the blocks again with the static ones only
  octree.blocks = [];
  const { min, max } = scene.getWorldExtends(isStatic);
  octree.update(min, max, statics);
  octree.dynamicContent.push(...scene.meshes.filter((m) => !staticSet.has(m)));
  scene.onNewMeshAddedObservable.add((m) => { octree.dynamicContent.push(m); });
  scene.onMeshRemovedObservable.add((m) => { if (staticSet.delete(m)) octree.removeMesh(m); });
  return octree;
}
