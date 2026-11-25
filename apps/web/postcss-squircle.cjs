/**
 * Squircle corners (owner, 26 Nov 2026): Apple's continuous corner, in the browsers that draw one.
 *
 * Every rounded rectangle in the source keeps its plain `border-radius`. After each rule that sets
 * one, this adds the same rule inside `@supports (corner-shape: squircle)` with the squircle and the
 * radius 1.4 times larger (a squircle of the same radius reads tighter). A browser without squircles
 * (Safari, Firefox, for now) sees exactly the corners it saw before. The source files stay as they
 * are, and every corner written later gets its squircle too.
 *
 * Pills and circles stay round: 50%, 100px and up, var(--r-pill). A radius variable can be a pill
 * in one place and a box in another (--field-radius is 10px in the dashboard, a pill in
 * onboarding), so wherever one is defined, two companions go with it: `--<name>-shape` (round for a
 * pill, squircle for a box) and `--<name>-scale` (1 or 1.4). A corner that reads the variable reads
 * its companions too; when the variable is not set, its fallback decides.
 */
const SCALE = 1.4;
const PILL_VARS = new Set(['--r-pill']);
const BOX_VARS = new Set(['--r-box']);

/** 'pill', 'box', 'zero' or null (unknown: left alone) for one radius token. */
function kindOf(token) {
  const t = token.trim();
  if (t === '0' || t === '0px') return 'zero';
  if (t.endsWith('%')) return t === '0%' ? 'zero' : 'pill';
  const px = /^(\d+(?:\.\d+)?)px$/.exec(t);
  if (px) {
    const n = Number(px[1]);
    if (n >= 100) return 'pill';
    return n < 3 ? 'zero' : 'box';
  }
  const v = /^var\((--[\w-]+)\s*(?:,\s*(.+))?\)$/.exec(t);
  if (v) {
    if (PILL_VARS.has(v[1])) return 'pill';
    if (BOX_VARS.has(v[1])) return 'box';
    return 'var';
  }
  return null;
}

/** Splits a radius value into its tokens, keeping var(...) whole. Null for an elliptic one ("a / b"). */
function tokens(value) {
  if (value.includes('/')) return null;
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of value.trim()) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (cur) out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** The squircle declarations for a border-radius value, or null to leave it alone. */
function squircle(value) {
  if (/!important/.test(value)) return null;
  const parts = tokens(value);
  if (!parts || parts.length === 0 || parts.length > 4) return null;
  const kinds = parts.map(kindOf);
  if (kinds.some((k) => k === null)) return null;
  // A pill stays a true pill, even where an earlier rule for the same element made it a squircle.
  if (kinds.includes('pill')) return { shape: 'round', radius: null };
  if (kinds.every((k) => k === 'zero')) return null;

  const vars = parts.filter((_, i) => kinds[i] === 'var');
  if (vars.length > 1) return null;
  if (vars.length === 1) {
    if (parts.length !== 1) return null;
    const [, name, fallback] = /^var\((--[\w-]+)\s*(?:,\s*(.+))?\)$/.exec(parts[0]);
    // With no value of its own, the variable is its fallback: that decides the defaults.
    const fallbackKind = fallback ? kindOf(fallback) : 'box';
    if (fallbackKind === null) return null;
    const pill = fallbackKind === 'pill';
    return {
      shape: `var(${name}-shape, ${pill ? 'round' : 'squircle'})`,
      radius: `calc(${parts[0]} * var(${name}-scale, ${pill ? 1 : SCALE}))`,
    };
  }
  const scaled = parts.map((p, i) => {
    if (kinds[i] === 'zero') return p;
    if (kinds[i] === 'box' && p.startsWith('var(')) return `calc(${p} * ${SCALE})`;
    const n = Number(/^(\d+(?:\.\d+)?)px$/.exec(p)[1]);
    return `${Math.round(n * SCALE)}px`;
  });
  return { shape: 'squircle', radius: scaled.join(' ') };
}

/** The companions for a radius variable's definition, or null when its value says nothing. */
function companions(prop, value) {
  if (!/radius/.test(prop)) return null;
  const parts = tokens(value);
  if (!parts || parts.length === 0) return null;
  const kinds = parts.map(kindOf);
  if (kinds.some((k) => k === null || k === 'var')) return null;
  const pill = kinds.includes('pill');
  return { shape: pill ? 'round' : 'squircle', scale: pill ? '1' : String(SCALE) };
}

function inKeyframes(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (p.type === 'atrule' && /keyframes$/i.test(p.name)) return true;
  }
  return false;
}

/** @type {import('postcss').PluginCreator<void>} */
module.exports = () => ({
  postcssPlugin: 'curios-squircle',
  OnceExit(root, { AtRule, Rule, Declaration }) {
    root.walkRules((rule) => {
      if (inKeyframes(rule) || rule.parent?.type === 'atrule' && rule.parent.name === 'supports' && /corner-shape/.test(rule.parent.params)) return;
      const extra = [];
      rule.each((decl) => {
        if (decl.type !== 'decl') return;
        if (decl.prop.startsWith('--')) {
          const c = companions(decl.prop, decl.value);
          if (c) {
            decl.cloneAfter({ prop: `${decl.prop}-scale`, value: c.scale });
            decl.cloneAfter({ prop: `${decl.prop}-shape`, value: c.shape });
          }
          return;
        }
        if (decl.prop !== 'border-radius' || decl.important) return;
        const s = squircle(decl.value);
        if (s) extra.push(s);
      });
      if (extra.length === 0) return;
      // The last border-radius in the rule is the one in force.
      const s = extra[extra.length - 1];
      const copy = new Rule({ selector: rule.selector });
      copy.append(new Declaration({ prop: 'corner-shape', value: s.shape }));
      if (s.radius) copy.append(new Declaration({ prop: 'border-radius', value: s.radius }));
      const at = new AtRule({ name: 'supports', params: '(corner-shape: squircle)' });
      at.append(copy);
      rule.after(at);
    });
  },
});
module.exports.postcss = true;
module.exports._test = { squircle, companions };
