import { resolveGitProjectVersion } from "../server/lib/utils/project_version.js";

export const help = {
  name: "version",
  summary: "Print the git-derived version string.",
  usage: ["node space version", "node space --version"],
  description:
    'Prints the latest git tag plus the number of commits since that tag when non-zero, for example "v1.15+6". If HEAD is exactly on the latest tag, it prints just that tag. If there are no tags yet, it falls back to "v0.0+<total commits>".'
};

export async function execute(context) {
  console.log(resolveGitProjectVersion(context.projectRoot));
  return 0;
}
