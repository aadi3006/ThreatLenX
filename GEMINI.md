# ThreatLenX Workspace Guidelines

## Autonomous Execution
- Execute tasks autonomously without prompting for confirmation or permission on routine actions (file edits, builds, linters, git operations).
- Only ask clarifying questions when there is genuine ambiguity, conflicting duplicate definitions, or risk of irrecoverable data loss.

## Automatic Git Workflow
- For any user prompt that introduces or completes changes to the codebase, automatically stage, commit, and push directly to GitHub as the final step of the turn:
  1. `git add .`
  2. `git commit -m "<Clear, descriptive summary of the completed change>"`
  3. `git push`
- Ensure commit messages describe the actual changes made (avoid generic messages like "update files").
