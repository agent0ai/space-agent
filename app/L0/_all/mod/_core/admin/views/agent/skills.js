import * as sharedSkills from "/mod/_core/skillset/skills.js";

const ADMIN_TOP_LEVEL_SKILL_FILE_PATTERN = sharedSkills.TOP_LEVEL_SKILL_FILE_PATTERN;
const ADMIN_ALL_SKILL_FILE_PATTERN = sharedSkills.ALL_SKILL_FILE_PATTERN;
const ADMIN_MAX_LAYER = 0;

export async function loadAdminSkillCatalog() {
  return sharedSkills.loadSkillIndex({
    maxLayer: ADMIN_MAX_LAYER,
    pattern: ADMIN_TOP_LEVEL_SKILL_FILE_PATTERN
  });
}

export async function buildAdminSkillsPromptSection() {
  const index = await loadAdminSkillCatalog();
  return sharedSkills.buildSkillCatalogPromptSection(index, {
    loadCommand: 'await space.admin.loadSkill("id")'
  });
}

export async function buildAdminJustLoadedSkillsPromptSection() {
  const index = await sharedSkills.loadSkillIndex({
    maxLayer: ADMIN_MAX_LAYER,
    pattern: ADMIN_ALL_SKILL_FILE_PATTERN
  });
  return sharedSkills.buildJustLoadedSkillsPromptSection(index);
}

export async function loadAdminSkill(name) {
  return {
    __spaceAdminSkill: true,
    ...(await sharedSkills.loadSkill({
      maxLayer: ADMIN_MAX_LAYER,
      path: name
    })),
    skillName: sharedSkills.normalizeSkillPath(name)
  };
}

export function installAdminSkillRuntime() {
  globalThis.space.admin = {
    ...(globalThis.space.admin && typeof globalThis.space.admin === "object" ? globalThis.space.admin : {}),
    loadSkill: loadAdminSkill
  };
}
