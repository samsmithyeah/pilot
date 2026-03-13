/**
 * Selectors for locating UI elements on mobile devices.
 *
 * Selectors are ordered by priority — prefer accessible selectors (role, text)
 * over implementation-detail selectors (testId, id, xpath).
 */

// ─── Types ───

export interface RoleSelectorValue {
  role: string;
  name: string;
}

export type SelectorKind =
  | { type: 'role'; value: RoleSelectorValue }
  | { type: 'text'; value: string }
  | { type: 'textContains'; value: string }
  | { type: 'contentDesc'; value: string }
  | { type: 'hint'; value: string }
  | { type: 'className'; value: string }
  | { type: 'testId'; value: string }
  | { type: 'id'; value: string }
  | { type: 'xpath'; value: string };

/**
 * A Selector identifies a UI element. Selectors can be scoped within a parent
 * selector to narrow the search.
 */
export interface Selector {
  readonly kind: SelectorKind;
  readonly parent?: Selector;

  /**
   * Scope this selector within a parent. Returns a new Selector with the
   * parent set.
   */
  within(parent: Selector): Selector;
}

// ─── Internal helpers ───

function createSelector(kind: SelectorKind, parent?: Selector): Selector {
  return {
    kind,
    parent,
    within(parentSelector: Selector): Selector {
      return createSelector(kind, parentSelector);
    },
  };
}

// ─── Proto serialization ───

/**
 * Converts a Selector into the proto-compatible shape expected by the gRPC
 * layer. This is the only place that knows about the protobuf message layout.
 */
export function selectorToProto(selector: Selector): Record<string, unknown> {
  const proto: Record<string, unknown> = {};

  switch (selector.kind.type) {
    case 'role':
      proto.role = {
        role: selector.kind.value.role,
        name: selector.kind.value.name,
      };
      break;
    case 'text':
      proto.text = selector.kind.value;
      break;
    case 'textContains':
      proto.textContains = selector.kind.value;
      break;
    case 'contentDesc':
      proto.contentDesc = selector.kind.value;
      break;
    case 'hint':
      proto.hint = selector.kind.value;
      break;
    case 'className':
      proto.className = selector.kind.value;
      break;
    case 'testId':
      proto.testId = selector.kind.value;
      break;
    case 'id':
      proto.resourceId = selector.kind.value;
      break;
    case 'xpath':
      proto.xpath = selector.kind.value;
      break;
  }

  if (selector.parent) {
    proto.parent = selectorToProto(selector.parent);
  }

  return proto;
}

// ─── Builder functions (ordered by priority) ───

/** Priority 1 — Match by accessibility role, optionally with an accessible name. */
export function role(roleName: string, name?: string): Selector {
  return createSelector({ type: 'role', value: { role: roleName, name: name ?? '' } });
}

/** Priority 1 — Match by exact text content. */
export function text(exactText: string): Selector {
  return createSelector({ type: 'text', value: exactText });
}

/** Priority 1 — Match when the element text contains the given substring. */
export function textContains(partial: string): Selector {
  return createSelector({ type: 'textContains', value: partial });
}

/** Priority 1 — Match by content description (accessibility label). */
export function contentDesc(desc: string): Selector {
  return createSelector({ type: 'contentDesc', value: desc });
}

/** Priority 2 — Match by hint text (placeholder). */
export function hint(hintText: string): Selector {
  return createSelector({ type: 'hint', value: hintText });
}

/** Priority 2 — Match by Android class name. */
export function className(name: string): Selector {
  return createSelector({ type: 'className', value: name });
}

/** Priority 3 — Match by test ID. */
export function testId(id: string): Selector {
  return createSelector({ type: 'testId', value: id });
}

/** Priority 3 — Match by Android resource ID. */
export function id(resourceId: string): Selector {
  return createSelector({ type: 'id', value: resourceId });
}

/** Priority 4 — Match by XPath expression. Use sparingly. */
export function xpath(expr: string): Selector {
  return createSelector({ type: 'xpath', value: expr });
}
