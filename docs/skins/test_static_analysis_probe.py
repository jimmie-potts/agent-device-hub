"""Disposable, unexecuted hosted gate probes. This branch must not merge."""


def expects_number(value: int) -> int:
    return value


def wrong_argument() -> int:
    return expects_number("intentional type error")


def wrong_return() -> int:
    return "intentional return error"


def shared_default(values=[]):
    return values


def undefined_name():
    return intentional_undefined_name
