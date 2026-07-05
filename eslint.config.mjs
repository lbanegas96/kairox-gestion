import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import importPlugin from 'eslint-plugin-import';
import globals from 'globals';

export default [
	{ ignores: ['node_modules/**', 'dist/**', 'build/**', 'vite.config.js'] },
	{
		files: ['**/*.js', '**/*.jsx'],
		plugins: { react, 'react-hooks': reactHooks, import: importPlugin },
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType: 'module',
			parserOptions: { ecmaFeatures: { jsx: true } },
			globals: { ...globals.browser, React: 'readonly', Intl: 'readonly' },
		},
		settings: {
			react: { version: 'detect' },
			'import/resolver': {
				node: { extensions: ['.js', '.jsx'] },
				alias: { map: [['@', './src']], extensions: ['.js', '.jsx'] },
			},
		},
		rules: {
			...react.configs.recommended.rules,
			...reactHooks.configs.recommended.rules,
			...importPlugin.flatConfigs.recommended.rules,

			// Rules turned off — safe with React 17+ new JSX transform
			'react/no-unescaped-entities': 'off',
			'react/display-name': 'off',
			'react/jsx-uses-react': 'off',
			'react/react-in-jsx-scope': 'off',
			'react/jsx-no-comment-textnodes': 'off',
			'import/no-named-as-default': 'off',
			'import/no-named-as-default-member': 'off',
			// Vite handles alias resolution (@/) at build time — eslint-plugin-import
			// doesn't understand the Vite config, so this rule produces false positives
			'import/no-unresolved': 'off',

			// Reactivated as warn — auditing phase (upgrade to error once count is zero)
			'react/prop-types': 'warn',
			'react/jsx-uses-vars': 'warn', // required so JSX usage counts as "used" for no-unused-vars
			'no-unused-vars': ['warn', { varsIgnorePattern: '^_', argsIgnorePattern: '^_' }],

			// Critical rules that prevent runtime errors
			'no-undef': 'error', // Undefined variables cause runtime errors

			// Override recommended import rules for stricter checking
			'import/no-self-import': 'error', // Extremely fast rule, breaking results in infinite loop/bundling error

			// Disable expensive rules for performance
			'import/no-cycle': 'off', // AI rarely makes this error, and the rule is very slow to run
		},
	},
	{ files: ['tools/**/*.js', 'tailwind.config.js'], languageOptions: { globals: globals.node } },
];
