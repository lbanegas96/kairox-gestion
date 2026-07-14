/** @type {import('tailwindcss').Config} */
module.exports = {
	darkMode: ['class'],
	content: [
		'./pages/**/*.{js,jsx}',
		'./components/**/*.{js,jsx}',
		'./app/**/*.{js,jsx}',
		'./src/**/*.{js,jsx}',
	],
	theme: {
		container: {
			center: true,
			padding: '2rem',
			screens: {
				'2xl': '1400px',
			},
		},
		extend: {
			fontSize: {
				/* Único escalón "chico" oficial por debajo de text-xs (12px) —
				   reemplaza los text-[10px]/text-[11px] arbitrarios que convivían
				   sin regla. Usado en badges, hints y meta-texto. */
				'2xs': ['11px', { lineHeight: '14px' }],
			},
			colors: {
				/* shadcn/ui tokens */
				border:     'hsl(var(--border))',
				input:      'hsl(var(--input))',
				ring:       'hsl(var(--ring))',
				background: 'hsl(var(--background))',
				foreground: 'hsl(var(--foreground))',
				primary: {
					DEFAULT:    'hsl(var(--primary))',
					foreground: 'hsl(var(--primary-foreground))',
				},
				secondary: {
					DEFAULT:    'hsl(var(--secondary))',
					foreground: 'hsl(var(--secondary-foreground))',
				},
				destructive: {
					DEFAULT:    'hsl(var(--destructive))',
					foreground: 'hsl(var(--destructive-foreground))',
				},
				muted: {
					DEFAULT:    'hsl(var(--muted))',
					foreground: 'hsl(var(--muted-foreground))',
				},
				accent: {
					DEFAULT:    'hsl(var(--accent))',
					foreground: 'hsl(var(--accent-foreground))',
				},
				popover: {
					DEFAULT:    'hsl(var(--popover))',
					foreground: 'hsl(var(--popover-foreground))',
				},
				card: {
					DEFAULT:    'hsl(var(--card))',
					foreground: 'hsl(var(--card-foreground))',
				},
				/* KAIROX v3 aurora tokens */
				'kx-bg':           'rgb(var(--kx-bg) / <alpha-value>)',
				'kx-surface':      'rgb(var(--kx-surface) / <alpha-value>)',
				'kx-surface-2':    'rgb(var(--kx-surface-2) / <alpha-value>)',
				'kx-border':       'var(--kx-border)',
				'kx-border-hover': 'var(--kx-border-hover)',
				'kx-text':         'rgb(var(--kx-text) / <alpha-value>)',
				'kx-text-2':       'rgb(var(--kx-text-2) / <alpha-value>)',
				'kx-text-3':       'rgb(var(--kx-text-3) / <alpha-value>)',
				'kx-green':        'rgb(var(--kx-green) / <alpha-value>)',
				'kx-red':          'rgb(var(--kx-red) / <alpha-value>)',
				'kx-amber':        'rgb(var(--kx-amber) / <alpha-value>)',
				'kx-blue':         'rgb(var(--kx-blue) / <alpha-value>)',
				'kx-violet':       'rgb(var(--kx-violet) / <alpha-value>)',
			},
			keyframes: {
				'accordion-down': {
					from: { height: 0 },
					to: { height: 'var(--radix-accordion-content-height)' },
				},
				'accordion-up': {
					from: { height: 'var(--radix-accordion-content-height)' },
					to: { height: 0 },
				},
				'kx-float1': {
					'0%,100%': { transform: 'translate(0,0)' },
					'50%':     { transform: 'translate(-40px,30px)' },
				},
				'kx-float2': {
					'0%,100%': { transform: 'translate(0,0)' },
					'50%':     { transform: 'translate(50px,-30px)' },
				},
				'kx-float3': {
					'0%,100%': { transform: 'translate(0,0)' },
					'50%':     { transform: 'translate(-30px,-40px)' },
				},
			},
			animation: {
				'accordion-down': 'accordion-down 0.2s ease-out',
				'accordion-up':   'accordion-up 0.2s ease-out',
				'kx-float1':      'kx-float1 22s ease-in-out infinite',
				'kx-float2':      'kx-float2 26s ease-in-out infinite',
				'kx-float3':      'kx-float3 30s ease-in-out infinite',
			},
		},
	},
	plugins: [require('tailwindcss-animate')],
};