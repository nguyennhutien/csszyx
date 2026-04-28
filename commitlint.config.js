export default {
    extends: ['@commitlint/config-conventional'],
    // release-please's release PR commit message follows the pattern
    //   "chore${scope}: release ${component} ${version}"
    // For our linked-versions group ("csszyx") the title looks like
    //   "chore: release csszyx 0.6.0"
    // commitlint accepts that as valid Conventional Commits, but we keep
    // an explicit bypass so any future release-please title format change
    // (e.g. multiple components) doesn't suddenly start blocking CI.
    ignores: [
        (msg) => /^chore(\([^)]*\))?: release\b/i.test(msg.trim()),
    ],
    rules: {
        'type-enum': [
            2,
            'always',
            [
                'feat', // New feature
                'fix', // Bug fix
                'docs', // Documentation
                'style', // Formatting
                'refactor', // Code restructuring
                'perf', // Performance
                'test', // Tests
                'chore', // Maintenance
                'ci', // CI/CD
                'build', // Build system
                'revert', // Reverts (recognized by release-please's CHANGELOG)
            ],
        ],
        'subject-case': [2, 'never', ['upper-case']],
        'header-max-length': [2, 'always', 100],
    },
};
