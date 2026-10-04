// Mono font checks: confusable glyphs, operator pairs, box drawing, wide lines.
// O0 Il1| S5 Z2 B8 rn m {} [] () <> `' "" ;: ,.

type Glyphs = "O0" | "Il1|" | "S5" | "Z2" | "B8" | "rn m";

const ops = [a => a, x != y, x !== y, x === y, x <= y, x >= y, a?.b ?? c, a || b && c];

const tree = `
pad/
├── scratchpad.json
├── notes.md
│   └── linked → ../README.md
└── snippets/
    ├── a.ts
    └── b.ts
`;

const i18n = { uk: "Привіт, світ", el: "Γειά σου κόσμε", de: "Grüße aus Zürich", ja: "こんにちは", emoji: "✅ 🚀" };

export function veryLongLineThatShouldWidenTheCardOrScrollHorizontallyDependingOnTheLayoutRules(argumentNumberOne: string, argumentNumberTwo: number): string { return `${argumentNumberOne}:${argumentNumberTwo}`; }

/** Bold and italic in highlight.js themes come from the mono face too. */
export class Sample<T extends Record<string, unknown>> {
  #secret = 0x1F_FF;
  constructor(private readonly value: T) {}
  get size(): number { return Object.keys(this.value).length * 1_000_000 + 0.25e-3; }
}
