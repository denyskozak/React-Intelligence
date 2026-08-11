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
};

type EventFilterKey = keyof EventFilterValues;

function isEmptyOrDefault(key: EventFilterKey, value: string) {
    return value === "" || value === DEFAULTS[key];
}

export function useEventFilters () {
    const [params, setParams] = useSearchParams();


    const type = params.get("type") ?? DEFAULTS.type;
    const route = params.get("route") ?? DEFAULTS.route;
    const release = params.get("release") ?? DEFAULTS.release;
    const environment = params.get("environment") ?? DEFAULTS.environment;
    const timeRange = params.get("timeRange") ?? DEFAULTS.timeRange;
    const search = params.get("search") ?? DEFAULTS.search;

    const values: EventFilterValues = useMemo(
        () => ({ type, route, release, environment, timeRange, search }),
        [type, route, release, environment, timeRange, search]
    );

    const [searchInput, setSearchInput] = useState(search);

    const setFilter = useCallback((key: EventFilterKey, value: string) => {
        setParams((current) => {
            const next = new URLSearchParams(current);

            if (isEmptyOrDefault(key, value)) {
                next.delete(key);
            } else {
                next.set(key, value);
            }

            return next;
        });
    }, [setParams]);

    useEffect(() => {
        setSearchInput(search);
    }, [search]);


    useEffect(() => {
        if (searchInput === search) return;

        const timeout = window.setTimeout(() => {
            setFilter("search", searchInput);
        }, 300);

        return () => window.clearTimeout(timeout);
    }, [searchInput, search, setFilter]);

    const reset = useCallback(() => {
        setParams({})
    }, [setParams])

    const apiParams = useMemo(() => {
        const next = new URLSearchParams(params);
        const filters: Array<[EventFilterKey, string]> = [
            ["type", type],
            ["route", route],
            ["release", release],
            ["environment", environment],
            ["timeRange", timeRange],
            ["search", search],
        ];

        filters.forEach(([key, value]) => {
            if (!isEmptyOrDefault(key, value)) next.set(key, value);
        });

        return next;
    }, [type, route, release, environment, timeRange, search]);

    return {
        values,
        searchInput,
        setSearchInput,
        setFilter,
        reset,
        apiParams
    }
}

