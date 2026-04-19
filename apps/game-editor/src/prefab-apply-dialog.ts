/**
 * Apply-to-Source dialog.
 *
 * Modal that lists every override on a prefab instance with a checkbox per
 * row. Confirming bakes the selected overrides into the source `.esprefab`
 * via {@link IPrefabService.applyToSource}; other live instances of the
 * same prefab are then hot-reloaded by the catalog watcher.
 *
 * The dialog is intentionally low-fidelity (vanilla DOM, inline styles to
 * match the rest of the editor's dialogs) — its job is to expose the
 * already-existing service surface, not to invent new UX patterns. A
 * richer per-override preview can layer on later without changing the
 * service contract.
 */

import type { IECSSceneService, PrefabOverride } from '@editrix/estella';
import type { IPrefabService, PrefabOverrideRef } from './services.js';
import { PREFAB_METADATA_KEYS } from './services.js';

const OVERLAY_STYLE = `
  position:fixed;inset:0;background:rgba(0,0,0,0.5);
  display:flex;align-items:center;justify-content:center;z-index:99999;
`;
const DIALOG_STYLE = `
  background:#2c2c32;border:1px solid #444;border-radius:8px;
  padding:18px 20px;min-width:480px;max-width:640px;max-height:80vh;
  display:flex;flex-direction:column;color:#ccc;font-family:inherit;
`;
const TITLE_STYLE = `font-size:14px;font-weight:600;margin-bottom:8px;`;
const SUBTITLE_STYLE = `font-size:12px;color:#999;margin-bottom:12px;`;
const LIST_STYLE = `
  flex:1;min-height:80px;max-height:380px;overflow-y:auto;
  background:#252529;border:1px solid #3a3a3e;border-radius:4px;
  padding:6px 4px;margin-bottom:14px;
`;
const ROW_STYLE = `display:flex;align-items:center;gap:8px;padding:4px 8px;font-size:12px;border-radius:3px;`;
const ROW_HOVER = `background:#34343a;`;
const CHECKBOX_STYLE = `cursor:pointer;`;
const BTN_BASE = `border-radius:6px;cursor:pointer;font-family:inherit;font-size:13px;padding:6px 16px;`;
const BTN_CANCEL = `${BTN_BASE} background:#333;border:1px solid #555;color:#ccc;`;
const BTN_APPLY = `${BTN_BASE} background:#4a8fff;border:none;color:#fff;`;

export interface ApplyPrefabDialogOptions {
  readonly entityId: number;
  readonly ecs: IECSSceneService;
  readonly prefabService: IPrefabService;
  /** Called when the user confirms with a non-empty selection. */
  readonly onConfirm: (selectedOverrides: readonly PrefabOverrideRef[]) => void | Promise<void>;
}

export function showApplyPrefabDialog(options: ApplyPrefabDialogOptions): void {
  // Force a flush so the live override list reflects the latest mutations
  // (otherwise a recently-edited field might not appear in the checklist
  // until the debounce window expires).
  options.prefabService.flushPendingOverrides();

  const info = options.prefabService.getInstanceInfo(options.entityId);
  if (!info) return;
  const allOverrides = readOverrides(options.ecs, info.entityId);
  if (allOverrides.length === 0) return;

  // Partition into customization vs placement. Placement overrides get
  // their own group with default-unchecked boxes — baking an instance's
  // world position into the source prefab rewrites the prefab's origin,
  // which is almost never the user's intent.
  const placementRefs = new Set(
    options.prefabService.getPlacementOverrides(info.entityId).map(serializeRef),
  );
  const customization: PrefabOverride[] = [];
  const placement: PrefabOverride[] = [];
  for (const o of allOverrides) {
    (placementRefs.has(serializeRef(toRef(o))) ? placement : customization).push(o);
  }

  const otherCount = options.prefabService.countInstancesOf(info.sourceUuid) - 1;

  const overlay = document.createElement('div');
  overlay.style.cssText = OVERLAY_STYLE;

  const dialog = document.createElement('div');
  dialog.style.cssText = DIALOG_STYLE;

  const title = document.createElement('div');
  title.style.cssText = TITLE_STYLE;
  title.textContent = `Apply to "${info.sourceName}"`;
  dialog.appendChild(title);

  const subtitle = document.createElement('div');
  subtitle.style.cssText = SUBTITLE_STYLE;
  subtitle.textContent = otherCount > 0
    ? `Selected overrides will modify the source prefab. ${String(otherCount)} other instance${otherCount === 1 ? '' : 's'} will be affected.`
    : 'Selected overrides will modify the source prefab. No other instances exist.';
  dialog.appendChild(subtitle);

  const listEl = document.createElement('div');
  listEl.style.cssText = LIST_STYLE;
  dialog.appendChild(listEl);

  const checkboxes: HTMLInputElement[] = [];
  const overrides: PrefabOverride[] = [];

  const appendGroupHeader = (label: string, hint: string): void => {
    const header = document.createElement('div');
    header.style.cssText = 'padding:6px 8px 4px;font-size:11px;color:#8a8a92;text-transform:uppercase;letter-spacing:0.04em;';
    header.textContent = label;
    listEl.appendChild(header);
    if (hint) {
      const sub = document.createElement('div');
      sub.style.cssText = 'padding:0 8px 6px;font-size:11px;color:#6e6e76;font-style:italic;';
      sub.textContent = hint;
      listEl.appendChild(sub);
    }
  };

  const appendOverrideRow = (override: PrefabOverride, defaultChecked: boolean): void => {
    const row = document.createElement('label');
    row.style.cssText = ROW_STYLE;
    row.addEventListener('mouseenter', () => { row.style.cssText = ROW_STYLE + ROW_HOVER; });
    row.addEventListener('mouseleave', () => { row.style.cssText = ROW_STYLE; });

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = defaultChecked;
    cb.style.cssText = CHECKBOX_STYLE;
    checkboxes.push(cb);
    overrides.push(override);
    row.appendChild(cb);

    const text = document.createElement('span');
    text.textContent = describeOverride(override);
    row.appendChild(text);
    listEl.appendChild(row);
  };

  if (customization.length > 0) {
    appendGroupHeader(`Customizations (${String(customization.length)})`, '');
    for (const o of customization) appendOverrideRow(o, true);
  }
  if (placement.length > 0) {
    appendGroupHeader(
      `Placement (${String(placement.length)})`,
      'Applying placement writes this instance\u2019s position / rotation / scale to the source.',
    );
    for (const o of placement) appendOverrideRow(o, false);
  }

  const buttons = document.createElement('div');
  buttons.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;';

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = BTN_CANCEL;
  cancelBtn.addEventListener('click', () => { overlay.remove(); });
  buttons.appendChild(cancelBtn);

  const applyBtn = document.createElement('button');
  applyBtn.textContent = 'Apply Selected';
  applyBtn.style.cssText = BTN_APPLY;
  applyBtn.addEventListener('click', () => {
    const selected: PrefabOverrideRef[] = [];
    for (let i = 0; i < overrides.length; i++) {
      if (checkboxes[i]?.checked) {
        const o = overrides[i];
        if (!o) continue;
        selected.push(toRef(o));
      }
    }
    overlay.remove();
    if (selected.length > 0) {
      void options.onConfirm(selected);
    }
  });
  buttons.appendChild(applyBtn);
  dialog.appendChild(buttons);

  overlay.appendChild(dialog);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

function readOverrides(ecs: IECSSceneService, rootId: number): PrefabOverride[] {
  const raw = ecs.getEntityMetadata(rootId, PREFAB_METADATA_KEYS.OVERRIDES);
  return Array.isArray(raw) ? (raw as PrefabOverride[]) : [];
}

/** Stable stringification of a PrefabOverrideRef for Set membership. */
function serializeRef(ref: PrefabOverrideRef): string {
  return [
    ref.prefabEntityId,
    ref.type,
    ref.componentType ?? '',
    ref.propertyName ?? '',
    ref.metadataKey ?? '',
  ].join('\u0001');
}

function toRef(o: PrefabOverride): PrefabOverrideRef {
  return {
    prefabEntityId: o.prefabEntityId,
    type: o.type,
    ...(o.componentType !== undefined ? { componentType: o.componentType } : {}),
    ...(o.componentData?.type !== undefined && o.componentType === undefined
      ? { componentType: o.componentData.type } : {}),
    ...(o.propertyName !== undefined ? { propertyName: o.propertyName } : {}),
    ...(o.metadataKey !== undefined ? { metadataKey: o.metadataKey } : {}),
  };
}

function describeOverride(o: PrefabOverride): string {
  switch (o.type) {
    case 'property':
      return `${o.componentType ?? '?'}.${o.propertyName ?? '?'} = ${formatValue(o.value)}`;
    case 'name':
      return `name → "${typeof o.value === 'string' ? o.value : ''}"`;
    case 'visibility':
      return `visible → ${String(o.value)}`;
    case 'component_added':
      return `add component ${o.componentData?.type ?? '?'}`;
    case 'component_replaced':
      return `replace component ${o.componentData?.type ?? '?'}`;
    case 'component_removed':
      return `remove component ${o.componentType ?? '?'}`;
    case 'metadata_set':
      return `metadata "${o.metadataKey ?? ''}" = ${formatValue(o.value)}`;
    case 'metadata_removed':
      return `remove metadata "${o.metadataKey ?? ''}"`;
  }
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return String(v);
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(3);
  if (typeof v === 'string') return `"${v}"`;
  if (typeof v === 'boolean') return String(v);
  try { return JSON.stringify(v); } catch { return Object.prototype.toString.call(v); }
}
