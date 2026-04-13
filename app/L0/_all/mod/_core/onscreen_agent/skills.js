import * as sharedSkills from "/mod/_core/skillset/skills.js";

export const ONSCREEN_TOP_LEVEL_SKILL_FILE_PATTERN = sharedSkills.TOP_LEVEL_SKILL_FILE_PATTERN;
export const ONSCREEN_ALL_SKILL_FILE_PATTERN = sharedSkills.ALL_SKILL_FILE_PATTERN;
export const ONSCREEN_SKILL_LOAD_HOOK_KEY = "__spaceOnscreenAgentOnSkillLoad";

const listDiscoveredSkillFiles = globalThis.space.extend(
  import.meta,
  async function listDiscoveredSkillFiles(pattern = ONSCREEN_TOP_LEVEL_SKILL_FILE_PATTERN) {
    return sharedSkills.listDiscoveredSkillFiles({
      pattern
    });
  }
);

const loadOnscreenSkillIndex = globalThis.space.extend(
  import.meta,
  async function loadOnscreenSkillIndex(options = {}) {
    return sharedSkills.loadSkillIndex({
      pattern: String(options.pattern || ONSCREEN_TOP_LEVEL_SKILL_FILE_PATTERN)
    });
  }
);

export const loadOnscreenSkillCatalog = globalThis.space.extend(
  import.meta,
  async function loadOnscreenSkillCatalog() {
    const index = await loadOnscreenSkillIndex();
    return index.skills;
  }
);

export const buildOnscreenSkillsPromptSection = globalThis.space.extend(
  import.meta,
  async function buildOnscreenSkillsPromptSection() {
    const index = await loadOnscreenSkillIndex();
    return sharedSkills.buildSkillCatalogPromptSection(index, {
      loadCommand: 'await space.skills.load("id")'
    });
  }
);

export const buildOnscreenJustLoadedSkillsPromptSection = globalThis.space.extend(
  import.meta,
  async function buildOnscreenJustLoadedSkillsPromptSection() {
    const index = await loadOnscreenSkillIndex({
      pattern: ONSCREEN_ALL_SKILL_FILE_PATTERN
    });
    return sharedSkills.buildJustLoadedSkillsPromptSection(index);
  }
);

export const loadOnscreenSkill = globalThis.space.extend(
  import.meta,
  async function loadOnscreenSkill(path) {
    const loadedSkill = {
      __spaceSkill: true,
      ...(await sharedSkills.loadSkill({
        path
      }))
    };

    const onSkillLoad = globalThis[ONSCREEN_SKILL_LOAD_HOOK_KEY];

    if (typeof onSkillLoad === "function") {
      try {
        onSkillLoad(loadedSkill);
      } catch {
        // Skill-load tracking should not prevent the skill itself from loading.
      }
    }

    return loadedSkill;
  }
);

export const installOnscreenSkillRuntime = globalThis.space.extend(
  import.meta,
  async function installOnscreenSkillRuntime() {
    globalThis.space.skills = {
      ...(globalThis.space.skills && typeof globalThis.space.skills === "object" ? globalThis.space.skills : {}),
      load: loadOnscreenSkill
    };

    return globalThis.space.skills;
  }
);
