import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage } from '../api'

type AsyncState<T> = {
  data: T | null
  error: string | null
  loading: boolean
}

export function useAsync<T>(loader: () => Promise<T>, key: string | number = 0) {
  const loaderRef = useRef(loader)
  const keyRef = useRef(key)
  const [generation, setGeneration] = useState(0)
  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    error: null,
    loading: true,
  })

  useEffect(() => {
    loaderRef.current = loader
  })

  useEffect(() => {
    const keyChanged = keyRef.current !== key
    keyRef.current = key
    let cancelled = false
    setState((current) => ({
      data: keyChanged ? null : current.data,
      error: null,
      loading: true,
    }))
    loaderRef
      .current()
      .then((data) => {
        if (!cancelled) setState({ data, error: null, loading: false })
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState((current) => ({
            data: keyChanged ? null : current.data,
            error: errorMessage(err),
            loading: false,
          }))
        }
      })
    return () => {
      cancelled = true
    }
  }, [generation, key])

  const reload = useCallback(() => {
    setGeneration((value) => value + 1)
  }, [])

  return { ...state, reload }
}
