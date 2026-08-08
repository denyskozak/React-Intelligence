import { useCallback, useEffect, useState, useMemo } from "react";
import { useSearchParams} from "react-router-dom";

type EventFilterValues = {
    type: string;
    route: string;
    release: string;
    environment: string;
    timeRange: string;
    search: string;
}

const DEFAULTS: EventFilterValues = {
    type: "all",
    route: "",
    release: "",
    environment: "",
    timeRange: "24h",
    search: "",
} as const;

type EventFilterKey = keyof EventFilterValues;

export function useEventFilters () {
    const [params, setParams] = useSearchParams();
    const values: EventFilterValues = useMemo(() => ({
        ...DEFAULTS,
        ...Object.fromEntries(params)
    }), [params]);

    const [searchInput, setSearchInput] = useState(values.search);

    const update = useCallback((key: EventFilterKey, value: string) => {
        setParams((current) => {
            const next = new URLSearchParams(current);
            const defaultValue = DEFAULTS[key];

            if (!value || value === defaultValue) {
                next.delete(key);
            } else {
                next.set(key, value);
            }

            return next;
        });
    }, [setParams]);

    useEffect(() => {
        setSearchInput(values.search);
    }, [values.search]);


    useEffect(() => {
        if (searchInput === values.search) return;

        const timeout = window.setTimeout(() => {
            update("search", searchInput);
        }, 300);

        return () => window.clearTimeout(timeout);
    }, [searchInput, values.search, update]);

    function reset() {
        setParams({})
    }

    const apiParams = useMemo(() => {
        const next = new URLSearchParams(params);

        if (next.get("type") === DEFAULTS.type) next.delete("type");
        if (next.get("timeRange") === DEFAULTS.timeRange) next.delete("timeRange");

        return next;
    }, [params]);

    return {
        values,
        searchInput,
        setSearchInput,
        update,
        reset,
        apiParams
    }
}

