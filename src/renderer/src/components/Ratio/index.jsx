import React from 'react'
import Form3CD from './Form3CD'

export default function Ratio({ entity, activeTB, prevTB, onPrevTBChange }) {
  return (
    <Form3CD
      entity={entity}
      activeTB={activeTB}
      prevTB={prevTB}
      onPrevTBChange={onPrevTBChange}
    />
  )
}
