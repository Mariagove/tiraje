import './styles.css'
import { mountShell } from '@/dev/shell'

// Fase 1-2: la rebanada vertical del sensor y el grabador de trazas.
// El juego todavía no existe; esta página es el aparato de medida.
const root = document.querySelector<HTMLDivElement>('#app')
if (root) mountShell(root)
