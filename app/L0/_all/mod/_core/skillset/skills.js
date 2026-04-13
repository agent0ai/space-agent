export const TOP_LEVEL_SKILL_FILE_PATTERN = "mod/*/*/ext/skills/*/SKILL.md";
export const ALL_SKILL_FILE_PATTERN = "mod/*/*/ext/skills/**/SKILL.md";
export const SKILL_FILE_NAME = "SKILL.md";
export const SKILLS_ROOT_SEGMENT = "/ext/skills/";
export const SKILL_CONTEXT_SELECTOR = "x-skill-context";

const BOOLEAN_FALSE_VALUES = new Set(["", "0", "false", "no", "off"]);
const BOOLEAN_TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const SKILL_TAG_PATTERN = /^[A-Za-z0-9._:/-]+$/u;

function readMetadataBooleanValue(value) {
  if (value === true || value === 1) {
    return true;
  }

  if (value === false || value === 0 || value == null) {
    return false;
  }

  const normalizedValue = String(value).trim().toLowerCase();

  if (BOOLEAN_FALSE_VALUES.has(normalizedValue)) {
    return false;
  }

  if (BOOLEAN_TRUE_VALUES.has(normalizedValue)) {
    return true;
  }

  return null;
}

export function normalizeSkillSegment(segment) {
  const value = String(segment || "").trim();

  if (!value || value === "." || value === ".." || !/^[A-Za-z0-9._-]+$/u.test(value)) {
    throw new Error(`Invalid skill path segment: ${segment}`);
  }

  return value;
}

export function normalizeSkillPath(path) {
  const rawPath = String(path || "").trim().replace(/^\/+|\/+$/gu, "");

  if (!rawPath) {
    throw new Error("Skill path must not be empty.");
  }

  return rawPath
    .split("/")
    .filter(Boolean)
    .map((segment) => normalizeSkillSegment(segment))
    .join("/");
}

function normalizeSkillTag(tag) {
  const value = String(tag || "").trim();

  if (!value) {
    return "";
  }

  if (!SKILL_TAG_PATTERN.test(value)) {
    throw new Error(`Invalid skill context tag: ${tag}`);
  }

  return value;
}

function parseTagString(value) {
  const rawValue = String(value || "").trim();

  if (!rawValue) {
    return [];
  }

  if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
    try {
      const parsedValue = JSON.parse(rawValue);
      return normalizeSkillTags(parsedValue);
    } catch {
      // Fall through to plain-text parsing.
    }
  }

  return rawValue
    .split(/[\s,]+/u)
    .map((tag) => {
      try {
        return normalizeSkillTag(tag);
      } catch {
        return "";
      }
    })
    .filter(Boolean);
}

export function normalizeSkillTags(value) {
  const tags = Array.isArray(value) ? value : [value];
  const uniqueTags = new Set();

  tags.forEach((entry) => {
    if (Array.isArray(entry)) {
      normalizeSkillTags(entry).forEach((tag) => uniqueTags.add(tag));
      return;
    }

    parseTagString(entry).forEach((tag) => uniqueTags.add(tag));
  });

  return [...uniqueTags].sort();
}

function normalizeSkillMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }

  return { ...metadata };
}

function normalizeSkillCondition(condition) {
  const booleanValue = readMetadataBooleanValue(condition);

  if (booleanValue !== null || condition == null) {
    return null;
  }

  if (typeof condition === "string" || Array.isArray(condition)) {
    const tags = normalizeSkillTags(condition);
    return tags.length ? { tags } : null;
  }

  if (typeof condition !== "object" || Array.isArray(condition)) {
    return null;
  }

  const tags = normalizeSkillTags(condition.tags);
  return tags.length ? { tags } : null;
}

function normalizeJustLoadedConfig(config) {
  const booleanValue = readMetadataBooleanValue(config);

  if (booleanValue === true) {
    return true;
  }

  if (booleanValue === false || config == null) {
    return null;
  }

  return normalizeSkillCondition(config);
}

function createContextTagSet(contextTags) {
  return new Set(
    Array.isArray(contextTags) && contextTags.length ? normalizeSkillTags(contextTags) : collectSkillContextTags()
  );
}

function matchesSkillCondition(condition, contextTagSet) {
  if (!condition) {
    return true;
  }

  return condition.tags.every((tag) => contextTagSet.has(tag));
}

function isSkillEligibleForContext(skill, contextTagSet) {
  return matchesSkillCondition(skill.when, contextTagSet);
}

function isSkillJustLoadedForContext(skill, contextTagSet) {
  if (!isSkillEligibleForContext(skill, contextTagSet)) {
    return false;
  }

  if (skill.justLoaded === true) {
    return true;
  }

  return matchesSkillCondition(skill.justLoaded, contextTagSet);
}

export function collectSkillContextTags(root = globalThis.document) {
  if (!root?.querySelectorAll) {
    return [];
  }

  const uniqueTags = new Set();
  const contextElements = Array.from(root.querySelectorAll(SKILL_CONTEXT_SELECTOR));

  contextElements.forEach((element) => {
    const tagValues = normalizeSkillTags([
      element.getAttribute("tag"),
      element.getAttribute("tags")
    ]);

    tagValues.forEach((tag) => uniqueTags.add(tag));
  });

  return [...uniqueTags].sort();
}

export function parseDiscoveredSkillFile(filePath) {
  const normalizedPath = String(filePath || "").trim();

  if (!normalizedPath.endsWith(`/${SKILL_FILE_NAME}`)) {
    return null;
  }

  const skillsRootIndex = normalizedPath.indexOf(SKILLS_ROOT_SEGMENT);

  if (skillsRootIndex === -1) {
    return null;
  }

  const moduleRootPath = normalizedPath.slice(0, skillsRootIndex);
  const moduleMatch = moduleRootPath.match(/^L[0-2]\/[^/]+\/mod\/([^/]+)\/([^/]+)$/u);

  if (!moduleMatch) {
    return null;
  }

  const relativeSkillPath = normalizedPath.slice(
    skillsRootIndex + SKILLS_ROOT_SEGMENT.length,
    -`/${SKILL_FILE_NAME}`.length
  );

  try {
    return {
      filePath: normalizedPath,
      modulePath: `/mod/${moduleMatch[1]}/${moduleMatch[2]}`,
      path: normalizeSkillPath(relativeSkillPath)
    };
  } catch {
    return null;
  }
}

function buildSkillListLines(skills) {
  return skills.map((skill) => {
    const description = skill.description ? `|${skill.description}` : "";
    return `${skill.path}|${skill.name}${description}`;
  });
}

function buildSkillConflictLines(conflicts) {
  if (!conflicts.length) {
    return [];
  }

  return [
    "conflicting skill ids:",
    ...conflicts.map((conflict) => {
      const modules = conflict.entries.map((entry) => entry.modulePath).join(", ");
      return `${conflict.path}|conflict|${modules}`;
    })
  ];
}

export function buildSkillFilePattern(path) {
  return `mod/*/*/ext/skills/${normalizeSkillPath(path)}/${SKILL_FILE_NAME}`;
}

export async function listDiscoveredSkillFiles(options = {}) {
  const pattern = String(options.pattern || TOP_LEVEL_SKILL_FILE_PATTERN);
  const body = {
    patterns: [pattern]
  };

  if (Number.isInteger(options.maxLayer)) {
    body.maxLayer = options.maxLayer;
  }

  let result;

  try {
    result = await globalThis.space.api.call("file_paths", {
      body,
      method: "POST"
    });
  } catch (error) {
    throw new Error(`Unable to list skills: ${error.message}`);
  }

  const matchedPaths = Array.isArray(result?.[pattern]) ? result[pattern] : [];
  const effectiveSkillFiles = new Map();

  matchedPaths.forEach((matchedPath) => {
    const skillFile = parseDiscoveredSkillFile(matchedPath);

    if (!skillFile) {
      return;
    }

    effectiveSkillFiles.set(`${skillFile.modulePath}|${skillFile.path}`, skillFile);
  });

  return [...effectiveSkillFiles.values()].sort((left, right) => {
    const pathCompare = left.path.localeCompare(right.path);

    if (pathCompare !== 0) {
      return pathCompare;
    }

    const moduleCompare = left.modulePath.localeCompare(right.modulePath);

    if (moduleCompare !== 0) {
      return moduleCompare;
    }

    return left.filePath.localeCompare(right.filePath);
  });
}

async function readSkillFiles(skillFiles) {
  if (!skillFiles.length) {
    return [];
  }

  let result;

  try {
    result = await globalThis.space.api.fileRead({
      files: skillFiles.map((skillFile) => skillFile.filePath)
    });
  } catch (error) {
    throw new Error(`Unable to read skills: ${error.message}`);
  }

  const files = Array.isArray(result?.files) ? result.files : [];
  const fileMap = new Map(
    files.map((file) => [String(file?.path || ""), String(file?.content || "")])
  );

  return skillFiles.map((skillFile) => {
    const content = fileMap.get(skillFile.filePath) || "";
    const parsedDocument = globalThis.space.utils.markdown.parseDocument(content);
    const frontmatter =
      parsedDocument?.frontmatter && typeof parsedDocument.frontmatter === "object"
        ? parsedDocument.frontmatter
        : {};
    const metadata = normalizeSkillMetadata(frontmatter.metadata);

    return {
      body: String(parsedDocument?.body || content),
      content,
      description: String(frontmatter.description || "").trim(),
      filePath: skillFile.filePath,
      justLoaded: normalizeJustLoadedConfig(metadata.just_loaded),
      metadata,
      modulePath: skillFile.modulePath,
      name: String(frontmatter.name || skillFile.path).trim() || skillFile.path,
      path: skillFile.path,
      when: normalizeSkillCondition(metadata.when)
    };
  });
}

function buildSkillIndex(discoveredSkills, contextTags = []) {
  const contextTagSet = createContextTagSet(contextTags);
  const groupedSkills = new Map();

  discoveredSkills
    .filter((skill) => isSkillEligibleForContext(skill, contextTagSet))
    .forEach((skill) => {
      if (!groupedSkills.has(skill.path)) {
        groupedSkills.set(skill.path, []);
      }

      groupedSkills.get(skill.path).push(skill);
    });

  const conflicts = [];
  const skills = [];

  groupedSkills.forEach((entries, path) => {
    if (entries.length === 1) {
      skills.push(entries[0]);
      return;
    }

    conflicts.push({
      entries: [...entries].sort((left, right) => left.modulePath.localeCompare(right.modulePath)),
      path
    });
  });

  skills.sort((left, right) => left.path.localeCompare(right.path));
  conflicts.sort((left, right) => left.path.localeCompare(right.path));

  return {
    conflicts,
    contextTags: [...contextTagSet].sort(),
    justLoadedSkills: skills.filter((skill) => isSkillJustLoadedForContext(skill, contextTagSet)),
    skills
  };
}

export async function loadSkillIndex(options = {}) {
  const skillFiles = await listDiscoveredSkillFiles({
    maxLayer: options.maxLayer,
    pattern: options.pattern
  });
  const discoveredSkills = await readSkillFiles(skillFiles);

  return buildSkillIndex(discoveredSkills, options.contextTags);
}

function findConflictingSkillEntry(conflicts, skillPath) {
  return conflicts.find((conflict) => conflict.path === skillPath) || null;
}

export async function loadSkill(options = {}) {
  const skillPath = normalizeSkillPath(options.path);
  const { conflicts, skills } = await loadSkillIndex({
    contextTags: options.contextTags,
    maxLayer: options.maxLayer,
    pattern: buildSkillFilePattern(skillPath)
  });
  const conflictingEntry = findConflictingSkillEntry(conflicts, skillPath);

  if (conflictingEntry) {
    const modules = conflictingEntry.entries.map((entry) => entry.modulePath).join(", ");
    throw new Error(`Unable to load skill "${skillPath}": conflicting skill ids in ${modules}`);
  }

  const skill = skills.find((entry) => entry.path === skillPath);

  if (!skill) {
    throw new Error(`Unable to load skill "${skillPath}": skill not found.`);
  }

  return {
    ...skill
  };
}

export function buildSkillCatalogPromptSection(index, options = {}) {
  const normalizedIndex = index && typeof index === "object" ? index : {};
  const conflicts = Array.isArray(normalizedIndex.conflicts) ? normalizedIndex.conflicts : [];
  const skills = Array.isArray(normalizedIndex.skills) ? normalizedIndex.skills : [];

  if (!skills.length && !conflicts.length) {
    return "";
  }

  return [
    "skills",
    "load on demand unless just loaded",
    "id = ext/skills path without /SKILL.md",
    `load: ${options.loadCommand || 'await space.skills.load("id")'}`,
    skills.length ? "skills id|name|description↓" : "no loadable skills",
    ...buildSkillListLines(skills),
    ...buildSkillConflictLines(conflicts)
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildJustLoadedSkillsPromptSection(index) {
  const justLoadedSkills = Array.isArray(index?.justLoadedSkills) ? index.justLoadedSkills : [];

  if (!justLoadedSkills.length) {
    return "";
  }

  return [
    "just loaded",
    ...justLoadedSkills.map((skill) => `id: ${skill.path}\n${skill.body}`)
  ]
    .filter(Boolean)
    .join("\n\n");
}
