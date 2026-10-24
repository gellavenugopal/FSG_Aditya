import React, { useEffect, useState } from 'react'

// A bare "Loading..." looks like a dead screen when a branch has tens of thousands of ledgers (the database alone can take a
// minute). Counting the seconds, and saying what is going on after a few of them, shows that it is working.
export default function LoadingNote({ what = 'the ledgers', className = '' }) {
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setSecs(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className={`text-gray-500 text-sm text-center ${className}`} data-testid="loading-note">
      Loading {what}… {secs > 0 ? `${secs} s` : ''}
      {secs >= 6 && (
        <div className="text-xs text-gray-400 mt-1">A branch with tens of thousands of ledgers can take a minute or more. The screen is working — please wait.</div>
      )}
    </div>
  )
}
