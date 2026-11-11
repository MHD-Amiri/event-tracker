/** @type {import('jest').Config} */
module.exports = {
    rootDir: '.',
    roots: ['<rootDir>/apps', '<rootDir>/libs'],
    moduleNameMapper: {
        '^@app/rmq$': '<rootDir>/libs/rmq/src/index.ts',
    },
    testMatch: ['**/*.spec.ts'],
    transform: {
        '^.+\\.tsx?$': ['ts-jest', {
            tsconfig: {
                module: 'commonjs',
                target: 'ES2021',
                emitDecoratorMetadata: true,
                experimentalDecorators: true,
                allowSyntheticDefaultImports: true,
                strictNullChecks: false,
                esModuleInterop: true,
                skipLibCheck: true,
                types: ['node', 'jest'],
            },
            isolatedModules: false,
        }],
    },
    testEnvironment: 'node',
    moduleFileExtensions: ['ts', 'js', 'json'],
    testTimeout: 60000,
};
