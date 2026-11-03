<script setup lang="ts">
import { computed, ref } from 'vue'
import { BookOpen, FilePlus2, RefreshCw, Sparkles, X } from 'lucide-vue-next'
import type { Skill } from '../lib/types'
import { call } from '../lib/api'

const ide = useIde()
const skills = ref<Skill[]>([])
const loading = ref(false)
const preview = ref<{ skill: Skill; text: string } | null>(null)
const showNew = ref(false)
const newName = ref('')
const creating = ref(false)

const grouped = computed(() => {
  const map = new Map<string, Skill[]>()
  for (const skill of skills.value) {
    map.set(skill.source, [...(map.get(skill.source) ?? []), skill])
  }
  return [...map.entries()]
})

async function load() {
  loading.value = true
  try {
    skills.value = await call<Skill[]>('skills_list')
  } catch (err) {
    ide.notify(String(err), 'error')
    skills.value = []
  } finally {
    loading.value = false
  }
}

async function openSkill(skill: Skill) {
  try {
    const text = await call<string>('skill_read', { path: skill.path })
    preview.value = { skill, text }
  } catch (err) {
    ide.notify(String(err), 'error')
  }
}

async function createSkill() {
  const name = newName.value.trim()
  if (!name) return
  creating.value = true
  try {
    const path = await call<string>('skill_scaffold', { name })
    showNew.value = false
    newName.value = ''
    await load()
    ide.notify('Skill created', 'success')
    await ide.openFile(path)
  } catch (err) {
    ide.notify(String(err), 'error')
  } finally {
    creating.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="pane">
    <div class="sidebar-header">
      <span class="sidebar-title">Skills</span>
      <div class="sidebar-actions">
        <button class="icon-btn" title="New skill" @click="showNew = true">
          <FilePlus2 :size="13" />
        </button>
        <button class="icon-btn" title="Refresh" @click="load">
          <RefreshCw :size="13" :class="{ spin: loading }" />
        </button>
      </div>
    </div>

    <div class="sidebar-body">
      <div v-if="!skills.length" class="skills-empty">
        <Sparkles :size="24" :stroke-width="1.4" style="opacity: 0.4" />
        <p>No skills found.</p>
        <span class="hint" style="text-align: center">
          Skills live in <code>.kodra/skills/&lt;name&gt;/SKILL.md</code> and in the user
          config directory. Create one to teach the agent a repeatable workflow.
        </span>
        <button class="btn primary sm" @click="showNew = true">
          <FilePlus2 :size="12" /> New skill
        </button>
      </div>

      <template v-for="[source, list] in grouped" :key="source">
        <div class="section-label">{{ source === 'user' ? 'User skills' : 'Workspace skills' }}</div>
        <button v-for="skill in list" :key="skill.path" class="skill-row" @click="openSkill(skill)">
          <BookOpen :size="13" />
          <div class="col">
            <span class="name">{{ skill.name }}</span>
            <span class="desc">{{ skill.description || 'No description' }}</span>
          </div>
        </button>
      </template>

      <div v-if="skills.length" class="callout" style="margin-top: 14px">
        The agent is told about available skills in its system prompt. Call a skill by
        name in chat to apply its workflow.
      </div>
    </div>

    <Teleport to="body">
      <div v-if="preview" class="overlay" @click.self="preview = null">
        <div class="modal" style="width: min(840px, 94vw); max-height: 86vh">
          <div class="modal-head">
            <BookOpen :size="15" />
            <h2>{{ preview.skill.name }}</h2>
            <span class="hint">{{ preview.skill.source }}</span>
            <div style="flex: 1" />
            <button class="icon-btn" @click="preview = null"><X :size="15" /></button>
          </div>
          <div class="modal-body" style="padding: 0">
            <pre class="skill-body">{{ preview.text }}</pre>
          </div>
          <div class="modal-foot">
            <div style="flex: 1" />
            <button class="btn ghost" @click="preview = null">Close</button>
            <button class="btn primary" @click="ide.openFile(preview.skill.path); preview = null">
              Open in editor
            </button>
          </div>
        </div>
      </div>

      <div v-if="showNew" class="overlay" @click.self="showNew = false">
        <div class="modal" style="width: min(420px, 92vw)">
          <div class="modal-head">
            <FilePlus2 :size="15" />
            <h2>New skill</h2>
            <div style="flex: 1" />
            <button class="icon-btn" @click="showNew = false"><X :size="15" /></button>
          </div>
          <div class="modal-body">
            <div class="field">
              <label>Skill name</label>
              <input
                v-model="newName"
                class="input"
                placeholder="release-checklist"
                @keydown.enter="createSkill"
              />
              <span class="hint">
                Creates <code>.kodra/skills/&lt;slug&gt;/SKILL.md</code> in the workspace.
              </span>
            </div>
          </div>
          <div class="modal-foot">
            <button class="btn ghost" @click="showNew = false">Cancel</button>
            <div style="flex: 1" />
            <button class="btn primary" :disabled="creating || !newName.trim()" @click="createSkill">
              Create
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.skills-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 30px 14px;
  color: var(--text-faint);
  font-size: 12px;
  text-align: center;
}
.skills-empty p {
  margin: 0;
}
.skill-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-dim);
  text-align: left;
  cursor: pointer;
}
.skill-row:hover {
  background: var(--glass);
  color: var(--text);
}
.skill-row .col {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.skill-row .name {
  font-size: 11.5px;
  font-weight: 500;
}
.skill-row .desc {
  font-size: 10px;
  color: var(--text-faint);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.skill-body {
  margin: 0;
  padding: 14px 16px;
  max-height: 60vh;
  overflow: auto;
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--text-dim);
  white-space: pre-wrap;
}
code {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--accent);
}
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
