import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'

export interface StableSelectOption {
  value: string
  label: string
  meta?: string | null
  disabled?: boolean
}

interface StableSelectProps {
  value: string
  options: StableSelectOption[]
  onChange: (value: string) => void
  disabled?: boolean
  id?: string
  ariaLabel?: string
  className?: string
  triggerClassName?: string
  menuClassName?: string
  placeholder?: string
}

interface MenuPosition {
  top: number
  left: number
  width: number
  maxHeight: number
  placement: 'above' | 'below'
}

function areMenuPositionsEqual(
  previousPosition: MenuPosition | null,
  nextPosition: MenuPosition,
) {
  return (
    previousPosition?.top === nextPosition.top &&
    previousPosition?.left === nextPosition.left &&
    previousPosition?.width === nextPosition.width &&
    previousPosition?.maxHeight === nextPosition.maxHeight &&
    previousPosition?.placement === nextPosition.placement
  )
}

function findNextEnabledIndex(
  options: StableSelectOption[],
  startIndex: number,
  step: 1 | -1,
) {
  let nextIndex = startIndex

  while (nextIndex >= 0 && nextIndex < options.length) {
    if (!options[nextIndex]?.disabled) {
      return nextIndex
    }

    nextIndex += step
  }

  return -1
}

function StableSelect({
  value,
  options,
  onChange,
  disabled = false,
  id,
  ariaLabel,
  className,
  triggerClassName,
  menuClassName,
  placeholder = 'Select',
}: StableSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const listboxId = useId()

  const selectedIndex = useMemo(
    () => options.findIndex((option) => option.value === value),
    [options, value],
  )
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : null

  const buildMenuPosition = useCallback((measuredMenuHeight?: number) => {
    const triggerElement = triggerRef.current

    if (!triggerElement) {
      return null
    }

    const triggerRect = triggerElement.getBoundingClientRect()
    const viewportHeight = window.innerHeight
    const viewportWidth = window.innerWidth
    const estimatedMenuHeight = Math.min(Math.max(options.length, 1) * 38 + 20, 300)
    const belowSpace = viewportHeight - triggerRect.bottom - 12
    const aboveSpace = triggerRect.top - 12
    const placeAbove =
      belowSpace < Math.min(estimatedMenuHeight, 220) && aboveSpace > belowSpace
    const maxHeight = Math.max(
      120,
      Math.min(placeAbove ? aboveSpace : belowSpace, 320),
    )
    const width = Math.min(Math.max(triggerRect.width, 132), viewportWidth - 16)
    const left = Math.min(
      Math.max(8, triggerRect.left),
      Math.max(8, viewportWidth - width - 8),
    )
    const placement: MenuPosition['placement'] = placeAbove ? 'above' : 'below'
    const resolvedMenuHeight = Math.min(
      measuredMenuHeight ?? estimatedMenuHeight,
      maxHeight,
    )
    const top = placeAbove
      ? Math.max(8, triggerRect.top - resolvedMenuHeight - 6)
      : Math.min(
          viewportHeight - resolvedMenuHeight - 8,
          triggerRect.bottom + 6,
        )

    return {
      top,
      left,
      width,
      maxHeight,
      placement,
    }
  }, [options.length])

  const updateMenuPosition = useCallback(
    (measuredMenuHeight?: number) => {
      const nextPosition = buildMenuPosition(measuredMenuHeight)

      if (!nextPosition) {
        return
      }

      setMenuPosition((previousPosition) =>
        areMenuPositionsEqual(previousPosition, nextPosition)
          ? previousPosition
          : nextPosition,
      )
    },
    [buildMenuPosition],
  )

  const closeMenu = useCallback(() => {
    setIsOpen(false)
    setMenuPosition(null)
  }, [])

  const openMenu = useCallback(() => {
    if (disabled || options.length === 0) {
      return
    }

    const preferredIndex = findNextEnabledIndex(
      options,
      selectedIndex >= 0 ? selectedIndex : 0,
      1,
    )
    const firstEnabledIndex =
      preferredIndex >= 0 ? preferredIndex : findNextEnabledIndex(options, 0, 1)

    setActiveIndex(firstEnabledIndex >= 0 ? firstEnabledIndex : -1)
    setMenuPosition(buildMenuPosition())
    setIsOpen(true)
  }, [buildMenuPosition, disabled, options, selectedIndex])

  const commitSelection = useCallback(
    (nextIndex: number) => {
      const option = options[nextIndex]

      if (!option || option.disabled) {
        return
      }

      onChange(option.value)
      closeMenu()
      window.setTimeout(() => {
        triggerRef.current?.focus()
      }, 0)
    },
    [closeMenu, onChange, options],
  )

  useLayoutEffect(() => {
    if (!isOpen || !menuPosition || !menuRef.current) {
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      const measuredMenuHeight = menuRef.current?.getBoundingClientRect().height

      if (!measuredMenuHeight) {
        return
      }

      updateMenuPosition(measuredMenuHeight)
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [isOpen, menuPosition, updateMenuPosition])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const handlePointerDown = (event: MouseEvent) => {
      const targetNode = event.target as Node | null

      if (
        targetNode &&
        !rootRef.current?.contains(targetNode) &&
        !menuRef.current?.contains(targetNode)
      ) {
        closeMenu()
      }
    }

    const handleFocusIn = (event: FocusEvent) => {
      const targetNode = event.target as Node | null

      if (
        targetNode &&
        !rootRef.current?.contains(targetNode) &&
        !menuRef.current?.contains(targetNode)
      ) {
        closeMenu()
      }
    }

    const handleViewportChange = () => {
      closeMenu()
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('focusin', handleFocusIn)
    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('scroll', handleViewportChange, true)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('focusin', handleFocusIn)
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
    }
  }, [closeMenu, isOpen])

  useEffect(() => {
    if (!isOpen || activeIndex < 0) {
      return
    }

    const activeOption = menuRef.current?.querySelector<HTMLButtonElement>(
      `[data-option-index="${activeIndex}"]`,
    )
    activeOption?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, isOpen])

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled || options.length === 0) {
      return
    }

    if (!isOpen) {
      if (
        event.key === 'ArrowDown' ||
        event.key === 'ArrowUp' ||
        event.key === 'Enter' ||
        event.key === ' '
      ) {
        event.preventDefault()
        openMenu()
      }

      return
    }

    if (event.key === 'Escape' || event.key === 'Tab') {
      closeMenu()
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((previousIndex) => {
        const nextStartIndex = previousIndex >= 0 ? previousIndex + 1 : 0
        const nextIndex = findNextEnabledIndex(options, nextStartIndex, 1)
        return nextIndex >= 0 ? nextIndex : previousIndex
      })
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((previousIndex) => {
        const nextStartIndex =
          previousIndex >= 0 ? previousIndex - 1 : options.length - 1
        const nextIndex = findNextEnabledIndex(options, nextStartIndex, -1)
        return nextIndex >= 0 ? nextIndex : previousIndex
      })
      return
    }

    if (event.key === 'Home') {
      event.preventDefault()
      const nextIndex = findNextEnabledIndex(options, 0, 1)
      if (nextIndex >= 0) {
        setActiveIndex(nextIndex)
      }
      return
    }

    if (event.key === 'End') {
      event.preventDefault()
      const nextIndex = findNextEnabledIndex(options, options.length - 1, -1)
      if (nextIndex >= 0) {
        setActiveIndex(nextIndex)
      }
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (activeIndex >= 0) {
        commitSelection(activeIndex)
      }
    }
  }

  const menu =
    isOpen && menuPosition
      ? createPortal(
          <div
            ref={menuRef}
            className={`stable-select__menu ${menuClassName ?? ''}`.trim()}
            style={{
              top: `${menuPosition.top}px`,
              left: `${menuPosition.left}px`,
              width: `${menuPosition.width}px`,
              maxHeight: `${menuPosition.maxHeight}px`,
            }}
            role="listbox"
            id={listboxId}
            aria-label={ariaLabel}
            aria-activedescendant={
              activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined
            }
            data-placement={menuPosition.placement}
          >
            {options.map((option, index) => {
              const isSelected = option.value === value
              const isActive = index === activeIndex

              return (
                <button
                  key={option.value}
                  id={`${listboxId}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  data-option-index={index}
                  className={`stable-select__option ${isSelected ? 'stable-select__option--selected' : ''} ${isActive ? 'stable-select__option--active' : ''}`.trim()}
                  disabled={option.disabled}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => commitSelection(index)}
                >
                  <span className="stable-select__option-copy">
                    <span className="stable-select__option-label">{option.label}</span>
                    {option.meta ? (
                      <span className="stable-select__option-meta">{option.meta}</span>
                    ) : null}
                  </span>
                  {isSelected ? (
                    <span className="stable-select__option-check" aria-hidden="true">
                      ok
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>,
          document.body,
        )
      : null

  return (
    <>
      <div
        ref={rootRef}
        className={`stable-select ${className ?? ''}`.trim()}
        data-open={isOpen ? 'true' : 'false'}
      >
        <button
          ref={triggerRef}
          id={id}
          type="button"
          className={`stable-select__trigger ${triggerClassName ?? ''}`.trim()}
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-controls={isOpen ? listboxId : undefined}
          disabled={disabled}
          onClick={() => {
            if (isOpen) {
              closeMenu()
              return
            }

            openMenu()
          }}
          onKeyDown={handleTriggerKeyDown}
        >
          <span className="stable-select__value" title={selectedOption?.label ?? placeholder}>
            {selectedOption?.label ?? placeholder}
          </span>
          <span className="stable-select__caret" aria-hidden="true">
            v
          </span>
        </button>
      </div>

      {menu}
    </>
  )
}

export default memo(StableSelect)
