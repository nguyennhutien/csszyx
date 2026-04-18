export default {
    extends: ['@commitlint/config-conventional'],
    // `changesets/action@v1` commits its Version Packages PR with the
    // literal message "Version Packages" (hardcoded, no override). Let it
    // bypass commitlint so husky's commit-msg hook doesn't block CI.
    ignores: [(message) => message.trim() === 'Version Packages'],
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
            ],
        ],
        'subject-case': [2, 'never', ['upper-case']],
        'header-max-length': [2, 'always', 100],
    },
};
