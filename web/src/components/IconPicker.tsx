/**
 * Choosing the bag an icon stands for, and the colour it prints in.
 *
 * Both are picked from fixed lists rather than typed or dialled in. The icon
 * has to be drawn by the print renderer, and a colour the owner cannot see
 * against their own field colour is an icon that does not help them find the
 * bag — which is the only reason it is there.
 */

import { motion } from 'motion/react'
import { ICON_COLORS, ICON_LABELS, ICON_NAMES, iconColour } from '../lib/icons'
import { BagGlyph } from './BagGlyph'

interface Props {
  icon: string | null
  color: string | null
  /** The surface the icon will sit on, so the preview matches the tag. */
  paper: string
  disabled?: boolean
  onChange: (next: { icon: string | null; color: string | null }) => void
}

export function IconPicker({ icon, color, paper, disabled, onChange }: Props) {
  const chosen = iconColour(color)

  return (
    <div className="stack stack--tight">
      <span className="field__label-text">Icon</span>
      <div className="icon-picker" role="group" aria-label="Bag icon">
        <button
          type="button"
          className={`icon-picker__option${icon === null ? ' is-selected' : ''}`}
          aria-pressed={icon === null}
          disabled={disabled}
          onClick={() => onChange({ icon: null, color })}
        >
          <span className="icon-picker__none" aria-hidden="true" />
          <span className="icon-picker__label">None</span>
        </button>

        {ICON_NAMES.map((name) => (
          <motion.button
            key={name}
            type="button"
            className={`icon-picker__option${icon === name ? ' is-selected' : ''}`}
            aria-pressed={icon === name}
            disabled={disabled}
            whileTap={{ scale: 0.92 }}
            transition={{ type: 'spring', stiffness: 500, damping: 22 }}
            onClick={() => onChange({ icon: name, color: color ?? 'ink' })}
          >
            <BagGlyph icon={name} color={chosen} paper={paper} size={32} />
            <span className="icon-picker__label">{ICON_LABELS[name] ?? name}</span>
          </motion.button>
        ))}
      </div>

      {icon && (
        <>
          <span className="field__label-text">Icon colour</span>
          <div className="swatches" role="group" aria-label="Icon colour">
            {Object.entries(ICON_COLORS).map(([name, hex]) => (
              <motion.button
                key={name}
                type="button"
                className={`swatch${(color ?? 'ink') === name ? ' is-selected' : ''}`}
                style={{ background: hex }}
                aria-label={name}
                aria-pressed={(color ?? 'ink') === name}
                disabled={disabled}
                whileTap={{ scale: 0.88 }}
                transition={{ type: 'spring', stiffness: 500, damping: 22 }}
                onClick={() => onChange({ icon, color: name })}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
