import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Material } from "@babylonjs/core/Materials/material";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { Rgba } from "../formats/Dds.ts";
import type { MshBone } from "../formats/Msh.ts";
import { skinVertices, type SkinTransform } from "../sim/anim/AutoAnimation.ts";
import type { ModelPart } from "../sim/character/PersonModel.ts";
import { makeTexture, WHITE } from "./textures.ts";

/** The input of `PersonMeshes`: a person's parts in the bind pose and their textures (a `PersonInWorld` or a viewer model). */
export interface PersonMeshSource {
  bind: (ModelPart & { cutout: boolean })[];
  textures: Map<string, Rgba>;
  skeleton: MshBone[];
}

/**
 * One person's meshes in a Babylon scene: a node holding a mesh per part (body, head, hair) in the game's (x, y, z up) -> Babylon (x, z, y) mapping, drawn unlit by
 * their texture (hair with an alpha cut-off). `applyPose` re-skins the skinned parts for a pose. Shared by the world view and the character viewer (docs/PEOPLE.md).
 */
export class PersonMeshes {
  readonly node: TransformNode;
  readonly meshes: Mesh[] = [];
  private readonly skinned: { mesh: Mesh; part: PersonMeshSource["bind"][number]; positions: Float32Array; normals: Float32Array; swz: Float32Array; swn: Float32Array }[] = [];
  private readonly materials: Map<string, StandardMaterial>;

  /** `materials` may be shared between people so one texture makes one material. `metadata` is put on the node and every mesh (for picking). */
  constructor(scene: Scene, source: PersonMeshSource, name: string, materials: Map<string, StandardMaterial>, metadata: unknown = null) {
    this.materials = materials;
    this.node = new TransformNode(name, scene);
    this.node.metadata = metadata;
    source.bind.forEach((part, i) => {
      const n = part.positions.length / 3;
      const positions = new Float32Array(n * 3);
      const normals = new Float32Array(n * 3);
      for (let v = 0; v < n; v++) {
        positions.set([part.positions[v * 3]!, part.positions[v * 3 + 2]!, part.positions[v * 3 + 1]!], v * 3);
        normals.set([part.normals[v * 3]!, part.normals[v * 3 + 2]!, part.normals[v * 3 + 1]!], v * 3);
      }
      const mesh = new Mesh(`${name}/${i}`, scene);
      const data = new VertexData();
      data.positions = positions;
      data.normals = normals;
      data.uvs = part.uv;
      data.indices = Uint32Array.from(part.indices);
      data.applyToMesh(mesh, part.skin !== null); // skinned parts get new vertices every frame
      if (part.skin) this.skinned.push({ mesh, part, positions: new Float32Array(part.positions.length), normals: new Float32Array(part.normals.length), swz: new Float32Array(positions.length), swn: new Float32Array(normals.length) });
      const key = `${part.texture.toLowerCase()}|${part.cutout ? 1 : 0}`;
      let mat = materials.get(key);
      if (!mat) {
        mat = new StandardMaterial(`person|${key}`, scene);
        const img = source.textures.get(part.texture.toLowerCase());
        const tex = makeTexture(scene, img ?? WHITE);
        mat.diffuseTexture = tex;
        mat.emissiveTexture = tex; // unlit: the texture is the colour
        mat.disableLighting = true;
        mat.specularColor = Color3.Black();
        mat.backFaceCulling = true;
        if (part.cutout) {
          tex.hasAlpha = true;
          mat.useAlphaFromDiffuseTexture = true;
          mat.transparencyMode = Material.MATERIAL_ALPHATEST;
          mat.alphaCutOff = 0.4;
        }
        materials.set(key, mat);
      }
      mesh.material = mat;
      mesh.parent = this.node;
      mesh.metadata = metadata;
      mesh.isPickable = true;
      this.meshes.push(mesh);
    });
  }

  /** Whether any part is skinned (and so can be posed). */
  get hasSkin(): boolean { return this.skinned.length > 0; }

  /** Re-skin the skinned parts with a pose's transforms (`skinTransforms`). */
  applyPose(transforms: SkinTransform[]): void {
    for (const m of this.skinned) {
      skinVertices(transforms, { positions: m.part.positions, normals: m.part.normals, skin: m.part.skin! }, m.positions, m.normals);
      for (let v = 0; v < m.positions.length; v += 3) { // game (x, y, z) -> Babylon (x, z, y)
        m.swz[v] = m.positions[v]!; m.swz[v + 1] = m.positions[v + 2]!; m.swz[v + 2] = m.positions[v + 1]!;
        m.swn[v] = m.normals[v]!; m.swn[v + 1] = m.normals[v + 2]!; m.swn[v + 2] = m.normals[v + 1]!;
      }
      m.mesh.updateVerticesData(VertexBuffer.PositionKind, m.swz);
      m.mesh.updateVerticesData(VertexBuffer.NormalKind, m.swn);
    }
  }

  /** Viewer switches: draw as wireframe, without textures (a flat colour), with back faces. Applies to this person's materials. */
  setLook(look: { wireframe: boolean; textured: boolean; doubleSided: boolean }): void {
    for (const m of this.meshes) {
      const mat = m.material as StandardMaterial | null;
      if (!mat) continue;
      mat.wireframe = look.wireframe;
      mat.backFaceCulling = !look.doubleSided;
      mat.emissiveTexture = look.textured ? mat.diffuseTexture : null;
      mat.emissiveColor = look.textured ? Color3.Black() : new Color3(0.75, 0.75, 0.78);
    }
  }

  dispose(): void {
    for (const m of this.meshes) m.dispose();
    this.node.dispose();
    for (const [, mat] of this.materials) { mat.diffuseTexture?.dispose(); mat.dispose(); }
    this.materials.clear();
  }
}
