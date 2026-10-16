/**
 * Lint policy. Two layers:
 *  1. typescript-eslint strictTypeChecked + stylisticTypeChecked, type-aware.
 *  2. Project invariants the presets cannot know, each tied to a defect
 *     class in docs/NOTEBOOK.md (2026-10-15 defect-coverage table).
 * Zero warnings allowed: the lint script runs with --max-warnings 0.
 */
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: ["node_modules/**", "vendor/**", "docs/**"],
  },
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Defect class: `==` coerces across bigint, number, and string.
      // The kernel compares all three.
      eqeqeq: "error",

      // Defect class: a non-exhaustive dispatch over ExprKind or LevelKind
      // silently returns undefined when a new kind arrives.
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        { considerDefaultExhaustiveForUnions: true },
      ],

      // Preset tuning, each with a reason, never a blanket off:
      // Error messages interpolate Name and Expr wrappers on purpose;
      // allow number/bigint/boolean, still reject objects without toString.
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        {
          allowNumber: true,
          allowBoolean: true,
          allowNever: false,
          // Name carries a cached, meaningful toString; error messages
          // interpolate it on purpose. Expr and Level must go through
          // exprToString / levelToString, so they stay banned.
          allow: [{ from: "file", name: "Name" }],
        },
      ],
      // The kernel walks self-referential structures where tsc cannot see
      // that a loop re-binds; the rule misfires on hot-loop guards.
      "@typescript-eslint/no-unnecessary-condition": "off",
      // Stacks of the explicit-stack machine mutate parameters by design.
      "@typescript-eslint/prefer-readonly-parameter-types": "off",
      // An underscore prefix marks a deliberately unused binding.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { varsIgnorePattern: "^_", argsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // The whole src tree must run under plain Node (the arena runner).
    // Defect class: a Bun global creeping in breaks the Node runner.
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "Bun", message: "src must run under Node. Use node: APIs." },
      ],
    },
  },
  {
    // Boundary code validates; it may not assert values into existence.
    files: ["src/export/**/*.ts", "src/checker.ts", "src/main.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "error",
    },
  },
  {
    // Kernel modules: hot paths index arrays under noUncheckedIndexedAccess,
    // and the C++ port's invariants guarantee presence. The notebook records
    // this decision; boundary code does not get the same license.
    files: ["src/kernel/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      // Defect class: an untyped throw loses the refusal/bug distinction
      // that the arena exit codes depend on. Kernel throws KernelError only.
      "no-restricted-syntax": [
        "error",
        {
          selector: "ThrowStatement > NewExpression[callee.name!='KernelError']",
          message: "Kernel modules throw KernelError only (typed refusals).",
        },
        {
          selector: "ThrowStatement > :not(NewExpression)",
          message: "Throw a constructed KernelError, not a bare value.",
        },
      ],
    },
  },
  {
    // JSON enters the program in exactly one place: the export parser.
    files: ["src/**/*.ts"],
    ignores: ["src/export/parser.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        { object: "JSON", property: "parse", message: "Parse NDJSON only in src/export/parser.ts." },
      ],
    },
  },
  {
    // Tests and scripts run under Bun and may use Bun APIs and assertions.
    files: ["tests/**/*.ts", "scripts/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
);
