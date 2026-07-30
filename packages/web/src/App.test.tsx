import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { App } from './App.js'

describe('App', () => {
  it('renders the scaffold-ready placeholder', () => {
    render(<App />)
    expect(screen.getByText(/scaffold ready/i)).toBeInTheDocument()
  })
})
