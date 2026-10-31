<script setup lang="ts">
import { computed } from 'vue'
import {
  Circle,
  CircleCheck,
  CircleStop,
  CircleX,
  ChevronDown,
  ChevronRight,
  FlaskConical,
  Loader2,
  Play,
  RefreshCw,
  SkipForward
} from 'lucide-vue-next'
import type { TestFile, TestStatus } from '../composables/useTests'

const ide = useIde()
const tests = useTests()

const grouped = computed(() => {
  const order = ['go', 'rust', 'python', 'node']
  const groups = new Map<string, TestFile[]>()
  for (const file of tests.files.value) {
    const list = groups.get(file.framework) ?? []
    list.push(file)
    groups.set(file.framework, list)
  }
  return [...groups.entries()]
    .sort((a, b) => {
      const ai = order.indexOf(a[0])
      const bi = order.indexOf(b[0])
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a[0].localeCompare(b[0])
    })
    .map(([framework, files]) => ({
      framework,
      label: tests.frameworkLabel(framework),
      files: [...files].sort((a, b) => a.rel.localeCompare(b.rel))
    }))
})

const runnerMissing = computed(() => {
  const found = tests.toolchain.value
  const missing: string[] = []
  const frameworks = new Set(tests.files.value.map((file) => file.framework))
  if (frameworks.has('go') && !found.go) missing.push('go')
  if (frameworks.has('rust') && !found.cargo) missing.push('cargo')
  if (frameworks.has('python') && !found.python) missing.push('python')
  if (frameworks.has('node') && !found.npm && !found.pnpm && !found.yarn) missing.push('npm')
  return missing
})

function iconFor(status: TestStatus) {
  if (status === 'passed') return CircleCheck
  if (status === 'failed') return CircleX
  if (status === 'skipped') return SkipForward
  if (status === 'running') return Loader2
  return Circle
}

function statusClass(status: TestStatus) {
  return status === 'idle' ? '' : `is-${status}`
}

function filename(file: TestFile) {
  return file.rel.split('/').pop() ?? file.rel
}

function folder(file: TestFile) {
  const rel = file.rel.replace(/\\/g, '/')
  const idx = rel.lastIndexOf('/')
  return idx < 0 ? '' : rel.slice(0, idx)
}

function open(file: TestFile, line?: number) {
  void ide.openFile(file.path, line)
}

function runAll() {
  ide.panelVisible.value = true
  ide.panelTab.value = 'tests'
  void tests.runAll()
}

function runTest(file: TestFile, name: string) {
  ide.panelVisible.value = true
  ide.panelTab.value = 'tests'
  void tests.runTest(file, name)
}

function runFile(file: TestFile) {
  ide.panelVisible.value = true
  ide.panelTab.value = 'tests'
  void tests.runFile(file)
}

function cancel() {
  void tests.cancel()
}

function refresh() {
  void tests.detect()
}
</script>

<template>
  <div class="pane tests-pane">
    <div class="sidebar-header">
      <span class="sidebar-title">Tests</span>
      <div class="sidebar-actions">
        <button
          class="icon-btn tests-run-all"
          title="Run all tests"
          :disabled="!tests.hasTests.value || tests.active.value"
          @click="runAll"
        >
          <Play :size="13" />
        </button>
        <button
          v-if="tests.active.value"
          class="icon-btn tests-cancel"
          title="Cancel run"
          @click="cancel"
        >
          <CircleStop :size="13" />
        </button>
        <button
          class="icon-btn tests-refresh"
          title="Refresh tests"
          :disabled="tests.loading.value"
          @click="refresh"
        >
          <RefreshCw :size="13" :class="{ 'is-spinning': tests.loading.value }" />
        </button>
      </div>
    </div>

    <div class="sidebar-body">
      <div class="tests-summary" :class="statusClass(tests.runStatus.value === 'idle' ? 'idle' : (tests.runStatus.value === 'passed' ? 'passed' : tests.runStatus.value === 'failed' ? 'failed' : 'running'))">
        <FlaskConical :size="13" />
        <span class="tests-summary-text">{{ tests.summary.value }}</span>
        <span v-if="tests.runStatus.value === 'running'" class="tests-spinner">
          <Loader2 :size="12" class="is-spinning" />
        </span>
      </div>

      <div v-if="!ide.workspace.value" class="tests-empty">
        Open a folder to discover tests.
      </div>
      <div v-else-if="tests.loading.value && !tests.hasTests.value" class="tests-empty">
        Scanning for tests…
      </div>
      <div v-else-if="!tests.hasTests.value" class="tests-empty">
        <p>No tests found.</p>
        <p class="tests-hint">Kudo looks for Go, Rust, Python and Node test files.</p>
        <button class="btn" @click="refresh">Scan again</button>
      </div>

      <template v-else>
        <div v-for="group in grouped" :key="group.framework" class="tests-group">
          <div class="tests-group-head">
            <span>{{ group.label }}</span>
            <span class="tests-group-count">{{ group.files.length }}</span>
          </div>

          <div v-for="file in group.files" :key="file.rel" class="test-file">
            <div class="tests-row test-file-row" :title="file.rel">
              <button
                class="tests-chevron"
                :title="tests.isCollapsed(file.rel) ? 'Expand' : 'Collapse'"
                @click="tests.toggleCollapsed(file.rel)"
              >
                <ChevronRight v-if="tests.isCollapsed(file.rel)" :size="13" />
                <ChevronDown v-else :size="13" />
              </button>
              <component
                :is="iconFor(tests.fileStatus(file))"
                :size="12"
                class="tests-status"
                :class="statusClass(tests.fileStatus(file))"
              />
              <button class="tests-name tests-open" @click="open(file, file.tests[0]?.line)">
                {{ filename(file) }}
                <span v-if="folder(file)" class="tests-folder">{{ folder(file) }}</span>
              </button>
              <button
                class="icon-btn tests-run-file"
                title="Run this file"
                :disabled="tests.active.value"
                @click="runFile(file)"
              >
                <Play :size="11" />
              </button>
            </div>

            <template v-if="!tests.isCollapsed(file.rel)">
              <div
                v-for="test in file.tests"
                :key="`${file.rel}:${test.name}`"
                class="tests-row test-item"
                :class="{ 'is-active': tests.runStatus.value === 'running' && tests.statusOf(file, test.name) === 'running' }"
                :title="`${test.name} — line ${test.line}`"
              >
                <span class="tests-indent" />
                <component
                  :is="iconFor(tests.statusOf(file, test.name))"
                  :size="12"
                  class="tests-status"
                  :class="[statusClass(tests.statusOf(file, test.name)), 'test-status']"
                  :data-status="tests.statusOf(file, test.name)"
                />
                <button class="tests-name tests-open" @click="open(file, test.line)">
                  {{ test.name }}
                </button>
                <button
                  class="icon-btn tests-run-one"
                  title="Run this test"
                  :disabled="tests.active.value"
                  @click="runTest(file, test.name)"
                >
                  <Play :size="11" />
                </button>
              </div>
              <div v-if="!file.tests.length" class="tests-row tests-no-tests">
                <span class="tests-indent" />
                <span class="tests-hint">Runs the project test script</span>
              </div>
            </template>
          </div>
        </div>

        <div v-if="runnerMissing.length" class="tests-warning">
          Runner not on PATH: <strong>{{ runnerMissing.join(', ') }}</strong>
        </div>
      </template>
    </div>
  </div>
</template>
