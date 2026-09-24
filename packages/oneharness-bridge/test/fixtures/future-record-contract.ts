//! The one definition of the channel the `future-record` stand-in is driven
//! over. The stand-in runs as a separate process, so the key naming its patch
//! is a contract between two files; declaring it here keeps the test that sets
//! it and the fixture that reads it from drifting apart.
export const FUTURE_RECORD_PATCH_ENV = "ONEHARNESS_UI_TEST_FUTURE_RECORD_PATCH";
