import type { HierarchyNode } from './hierarchy-utils.js'

// ─── Role Mapping ───

const ANDROID_CLASS_TO_ROLE: Record<string, string> = {
  'android.widget.Button': 'button',
  'android.widget.ImageButton': 'button',
  'com.google.android.material.button.MaterialButton': 'button',
  'androidx.appcompat.widget.AppCompatButton': 'button',
  'android.widget.EditText': 'textfield',
  'android.widget.AutoCompleteTextView': 'textfield',
  'com.google.android.material.textfield.TextInputEditText': 'textfield',
  'androidx.appcompat.widget.AppCompatEditText': 'textfield',
  'android.widget.CheckBox': 'checkbox',
  'androidx.appcompat.widget.AppCompatCheckBox': 'checkbox',
  'com.google.android.material.checkbox.MaterialCheckBox': 'checkbox',
  'android.widget.Switch': 'switch',
  'androidx.appcompat.widget.SwitchCompat': 'switch',
  'com.google.android.material.switchmaterial.SwitchMaterial': 'switch',
  'android.widget.ImageView': 'image',
  'androidx.appcompat.widget.AppCompatImageView': 'image',
  'android.widget.TextView': 'text',
  'androidx.appcompat.widget.AppCompatTextView': 'text',
  'com.google.android.material.textview.MaterialTextView': 'text',
  'android.widget.SearchView': 'searchfield',
  'androidx.appcompat.widget.SearchView': 'searchfield',
  'android.widget.RadioButton': 'radiobutton',
  'androidx.appcompat.widget.AppCompatRadioButton': 'radiobutton',
  'android.widget.Spinner': 'spinner',
  'androidx.appcompat.widget.AppCompatSpinner': 'spinner',
  'android.widget.ProgressBar': 'progressbar',
  'android.widget.SeekBar': 'seekbar',
  'com.google.android.material.slider.Slider': 'seekbar',
}

const IOS_TYPE_TO_ROLE: Record<string, string> = {
  'XCUIElementTypeButton': 'button',
  'XCUIElementTypeTextField': 'textfield',
  'XCUIElementTypeSecureTextField': 'textfield',
  'XCUIElementTypeTextView': 'textfield',
  'XCUIElementTypeSwitch': 'switch',
  'XCUIElementTypeCheckBox': 'checkbox',
  'XCUIElementTypeImage': 'image',
  'XCUIElementTypeStaticText': 'text',
  'XCUIElementTypeSearchField': 'searchfield',
  'XCUIElementTypeSlider': 'seekbar',
  'XCUIElementTypeProgressIndicator': 'progressbar',
  'XCUIElementTypePicker': 'spinner',
  'XCUIElementTypeRadioButton': 'radiobutton',
}

// ─── Attribute Helpers ───

function getRole(node: HierarchyNode): string | null {
  const className = node.attributes.get('class')
  if (className) {
    return ANDROID_CLASS_TO_ROLE[className] ?? null
  }
  const iosType = node.attributes.get('type') ?? node.tagName
  return IOS_TYPE_TO_ROLE[iosType] ?? null
}

function getText(node: HierarchyNode): string {
  return node.attributes.get('text') ?? node.attributes.get('label') ?? ''
}

function getContentDesc(node: HierarchyNode): string {
  return node.attributes.get('content-desc') ?? ''
}

function getLabel(node: HierarchyNode): string {
  return node.attributes.get('label') ?? ''
}

function getHint(node: HierarchyNode): string {
  return node.attributes.get('hint') ?? node.attributes.get('placeholderValue') ?? ''
}

function getResourceId(node: HierarchyNode): string {
  return node.attributes.get('resource-id') ?? node.attributes.get('identifier') ?? ''
}

function isIos(node: HierarchyNode): boolean {
  return node.tagName.startsWith('XCUI') || node.attributes.has('type')
}

// ─── Selector Generation ───

export interface GeneratedSelector {
  code: string
  label: string
  priority: number
}

export function generateSelectors(node: HierarchyNode): GeneratedSelector[] {
  const selectors: GeneratedSelector[] = []
  const role = getRole(node)
  const text = getText(node)
  const contentDesc = getContentDesc(node)
  const label = getLabel(node)
  const hint = getHint(node)
  const resourceId = getResourceId(node)
  const ios = isIos(node)

  // The accessible name for role-based selectors: on iOS use label, on
  // Android prefer content-desc, then text.
  const accessibleName = ios ? label : (contentDesc || text)

  // 1. Role + name (highest priority — Testing Library #1)
  if (role && accessibleName) {
    selectors.push({
      code: `device.getByRole("${role}", { name: "${accessibleName}" })`,
      label: 'Role + name',
      priority: 1,
    })
  }

  // 2. Role without name
  if (role && !accessibleName) {
    selectors.push({
      code: `device.getByRole("${role}")`,
      label: 'Role',
      priority: 2,
    })
  }

  // 3. Text (Testing Library #2 — visible text)
  if (text) {
    selectors.push({
      code: `device.getByText("${text}")`,
      label: 'Text',
      priority: 3,
    })
  }

  // 4. iOS label as text (when label serves as visible text, not content-desc)
  if (ios && label && !text) {
    selectors.push({
      code: `device.getByText("${label}")`,
      label: 'Text (label)',
      priority: 3,
    })
  }

  // 5. Description / accessibility label (Testing Library #3)
  if (contentDesc) {
    selectors.push({
      code: `device.getByDescription("${contentDesc}")`,
      label: 'Description',
      priority: 4,
    })
  }
  if (ios && label && contentDesc !== label) {
    selectors.push({
      code: `device.getByDescription("${label}")`,
      label: 'Description (label)',
      priority: 4,
    })
  }

  // 6. Placeholder / hint (Testing Library #4)
  if (hint) {
    selectors.push({
      code: `device.getByPlaceholder("${hint}")`,
      label: 'Placeholder',
      priority: 5,
    })
  }

  // 7. Test ID (Testing Library #5)
  const testIdFromResource = extractTestId(resourceId)
  if (testIdFromResource) {
    selectors.push({
      code: `device.getByTestId("${testIdFromResource}")`,
      label: 'Test ID',
      priority: 6,
    })
  }

  // Sort by priority, deduplicate by code
  const seen = new Set<string>()
  return selectors
    .sort((a, b) => a.priority - b.priority)
    .filter(s => {
      if (seen.has(s.code)) return false
      seen.add(s.code)
      return true
    })
}

function extractTestId(resourceId: string): string | null {
  if (!resourceId) return null
  const colonIdx = resourceId.indexOf(':id/')
  if (colonIdx !== -1) return resourceId.slice(colonIdx + 4)
  return resourceId
}

export function generateBestSelector(node: HierarchyNode): string {
  const selectors = generateSelectors(node)
  return selectors.length > 0 ? selectors[0].code : `// No selector available`
}
