import React from 'react'

// No uncaught render/effect error anywhere in the tree was ever caught —
// React unmounts the whole app on one, leaving a blank white screen with no
// indication of what broke or where. This makes every such bug undiagnosable
// without opening DevTools (which most users of this app won't know how to
// do), and un-recoverable without a full relaunch. Catching it here means a
// future bug of this class degrades to a readable error screen instead of a
// dead app, and the message/stack is visible without any tooling.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    this.setState({ info })
    console.error('Uncaught render error:', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '24px', fontFamily: 'sans-serif', color: '#1f2937', maxWidth: '900px', margin: '0 auto' }}>
          <h1 style={{ fontSize: '18px', fontWeight: 'bold', color: '#b91c1c' }}>Something went wrong</h1>
          <p style={{ fontSize: '13px', color: '#4b5563', marginTop: '8px' }}>
            The app hit an unexpected error and couldn't continue. Please share this text so it can be fixed.
          </p>
          <pre style={{
            marginTop: '12px', padding: '12px', background: '#f3f4f6', border: '1px solid #e5e7eb',
            borderRadius: '6px', fontSize: '12px', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            {String(this.state.error?.stack || this.state.error?.message || this.state.error)}
            {this.state.info?.componentStack ? '\n\nComponent stack:' + this.state.info.componentStack : ''}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: '16px', padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', cursor: 'pointer' }}
          >
            Reload App
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
