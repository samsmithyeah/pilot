/**
 * eslint-plugin-pilot
 *
 * ESLint rules that encourage accessible, maintainable selectors in Pilot
 * tests.
 *
 * Rules:
 *   - prefer-role: Warns when className() is used for standard Android widgets
 *     that have well-known accessibility roles.
 *   - no-bare-xpath: Errors when xpath() is used without an explanatory
 *     comment on the same or preceding line.
 *   - prefer-accessible-selectors: Warns when testId() or id() is used
 *     instead of role/text/contentDesc selectors.
 */

// We define our own minimal types to avoid a hard dependency on @types/eslint.

interface ASTNode {
  type: string;
  callee?: { type: string; name?: string };
  arguments?: ASTNode[];
  value?: unknown;
  loc?: { start: { line: number }; end: { line: number } };
}

interface Comment {
  loc?: { start: { line: number }; end: { line: number } };
}

interface SourceCode {
  getCommentsBefore(node: ASTNode): Comment[];
  getAllComments(): Comment[];
}

interface RuleContext {
  report(descriptor: {
    node: ASTNode;
    messageId: string;
    data?: Record<string, string>;
  }): void;
  sourceCode?: SourceCode;
  getSourceCode(): SourceCode;
}

interface RuleModule {
  meta: {
    type: string;
    docs: { description: string; recommended: boolean };
    messages: Record<string, string>;
    schema: unknown[];
  };
  create(context: RuleContext): Record<string, (node: ASTNode) => void>;
}

// ─── Standard widgets that should use role() instead of className() ───

const STANDARD_WIDGET_MAP: Record<string, string> = {
  'android.widget.Button': 'button',
  'android.widget.CheckBox': 'checkbox',
  'android.widget.EditText': 'textfield',
  'android.widget.ImageButton': 'button',
  'android.widget.ImageView': 'image',
  'android.widget.ProgressBar': 'progressbar',
  'android.widget.RadioButton': 'radio',
  'android.widget.SeekBar': 'slider',
  'android.widget.Spinner': 'combobox',
  'android.widget.Switch': 'switch',
  'android.widget.TextView': 'text',
  'android.widget.ToggleButton': 'togglebutton',
};

// ─── prefer-role ───

const preferRole: RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Prefer role() selector over className() for standard Android widgets',
      recommended: true,
    },
    messages: {
      preferRole:
        'Use role("{{role}}") instead of className("{{className}}"). Role-based selectors are more resilient to implementation changes.',
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node: ASTNode) {
        if (
          node.callee?.type === 'Identifier' &&
          node.callee.name === 'className' &&
          node.arguments &&
          node.arguments.length >= 1
        ) {
          const arg = node.arguments[0];
          if (arg.type === 'Literal' && typeof arg.value === 'string') {
            const role = STANDARD_WIDGET_MAP[arg.value];
            if (role) {
              context.report({
                node,
                messageId: 'preferRole',
                data: { role, className: arg.value },
              });
            }
          }
        }
      },
    };
  },
};

// ─── no-bare-xpath ───

const noBareXpath: RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require an explanatory comment when using xpath() selectors',
      recommended: true,
    },
    messages: {
      noBareXpath:
        'xpath() selectors must have an explanatory comment on the same or preceding line. XPath selectors are fragile — document why this is necessary.',
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node: ASTNode) {
        if (
          node.callee?.type === 'Identifier' &&
          node.callee.name === 'xpath'
        ) {
          const sourceCode = context.sourceCode ?? context.getSourceCode();
          const comments = sourceCode.getCommentsBefore(node);

          // Check comments directly before the node
          if (comments.length > 0) return;

          // Also check for inline comments on the same line
          const allComments = sourceCode.getAllComments();
          const nodeLine = node.loc?.start.line;
          const hasInlineComment = allComments.some(
            (c) => c.loc?.start.line === nodeLine || c.loc?.end.line === nodeLine,
          );

          if (!hasInlineComment) {
            context.report({
              node,
              messageId: 'noBareXpath',
            });
          }
        }
      },
    };
  },
};

// ─── prefer-accessible-selectors ───

const preferAccessibleSelectors: RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Prefer accessible selectors (role, text, contentDesc) over testId/id',
      recommended: true,
    },
    messages: {
      preferAccessible:
        'Prefer role(), text(), textContains(), or contentDesc() over {{name}}(). Accessible selectors make tests more resilient and verify accessibility.',
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node: ASTNode) {
        if (node.callee?.type === 'Identifier') {
          const name = node.callee.name;
          if (name === 'testId' || name === 'id') {
            context.report({
              node,
              messageId: 'preferAccessible',
              data: { name },
            });
          }
        }
      },
    };
  },
};

// ─── Plugin export ───

const rules: Record<string, RuleModule> = {
  'prefer-role': preferRole,
  'no-bare-xpath': noBareXpath,
  'prefer-accessible-selectors': preferAccessibleSelectors,
};

const recommendedConfig = {
  plugins: ['pilot'] as const,
  rules: {
    'pilot/prefer-role': 'warn' as const,
    'pilot/no-bare-xpath': 'error' as const,
    'pilot/prefer-accessible-selectors': 'warn' as const,
  },
};

export { rules, recommendedConfig as configs };
export default { rules, configs: { recommended: recommendedConfig } };
