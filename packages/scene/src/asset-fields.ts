/**
 * Asset-field subtype registry: tells the inspector which asset kind a
 * component's asset-typed field expects — `Sprite.texture → 'texture'`,
 * `SpriteAnimator.clip → 'anim-clip'`, etc.
 *
 * The SDK owns the canonical list at runtime via `AssetFieldRegistry`,
 * but the editor needs this info at schema-load time which runs *before*
 * the runtime App has built (and therefore before the SDK registry is
 * populated). We keep a frozen mirror here; the SDK's list is stable
 * enough that drift review on bump is straightforward.
 */

import type { AssetFieldSubtype } from './serialization.js';

export const BUILTIN_ASSET_FIELD_SUBTYPES: Readonly<
  Record<string, Readonly<Record<string, AssetFieldSubtype>>>
> = Object.freeze({
  Sprite: { texture: 'texture', material: 'material' },
  SpineAnimation: { material: 'material' },
  BitmapText: { font: 'font' },
  Image: { texture: 'texture', material: 'material' },
  UIRenderer: { texture: 'texture', material: 'material' },
  SpriteAnimator: { clip: 'anim-clip' },
  AudioSource: { clip: 'audio' },
  ParticleEmitter: { texture: 'texture', material: 'material' },
  Tilemap: { source: 'tilemap' },
  TilemapLayer: { tileset: 'texture' },
  TimelinePlayer: { timeline: 'timeline' },
});

/**
 * Look up a component/field's asset subtype, or return `undefined` when
 * the field isn't registered as an asset reference.
 */
export function assetFieldSubtype(
  componentName: string,
  fieldKey: string,
): AssetFieldSubtype | undefined {
  return BUILTIN_ASSET_FIELD_SUBTYPES[componentName]?.[fieldKey];
}
