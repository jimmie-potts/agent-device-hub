// Minimal host test harness: TEST() registers a case, CHECK() records a
// failure and keeps going, REQUIRE() stops the current case.
#pragma once

#include <cstdio>
#include <functional>
#include <sstream>
#include <string>
#include <vector>

namespace testing
{

struct Case
{
    const char*           name;
    std::function<void()> body;
};

std::vector<Case>& Registry();
void               Fail(const char* file, int line, const std::string& what);
void               CountCheck();
const char*        FixturePath();

struct Registrar
{
    Registrar(const char* name, std::function<void()> body)
    {
        Registry().push_back({name, std::move(body)});
    }
};

struct Abort
{
};

template <typename A, typename B>
std::string Describe(const char* a_text, const char* b_text, const A& a,
                     const B& b)
{
    std::ostringstream s;
    s << a_text << " == " << b_text << " (" << +a << " vs " << +b << ")";
    return s.str();
}

inline std::string Describe(const char* a_text, const char* b_text,
                            const std::string& a, const std::string& b)
{
    return std::string(a_text) + " == " + b_text + " (\"" + a + "\" vs \"" + b
           + "\")";
}

} // namespace testing

#define TEST_CONCAT2(a, b) a##b
#define TEST_CONCAT(a, b) TEST_CONCAT2(a, b)
#define TEST(name)                                                        \
    static void TEST_CONCAT(test_fn_, __LINE__)();                        \
    static ::testing::Registrar TEST_CONCAT(test_reg_, __LINE__)(         \
        name, TEST_CONCAT(test_fn_, __LINE__));                           \
    static void TEST_CONCAT(test_fn_, __LINE__)()

#define CHECK(cond)                                                       \
    do                                                                    \
    {                                                                     \
        ::testing::CountCheck();                                          \
        if(!(cond))                                                       \
            ::testing::Fail(__FILE__, __LINE__, #cond);                   \
    } while(0)

#define CHECK_EQ(a, b)                                                    \
    do                                                                    \
    {                                                                     \
        ::testing::CountCheck();                                          \
        const auto& test_a_ = (a);                                        \
        const auto& test_b_ = (b);                                        \
        if(!(test_a_ == test_b_))                                         \
            ::testing::Fail(__FILE__, __LINE__,                           \
                            ::testing::Describe(#a, #b, test_a_, test_b_)); \
    } while(0)

#define REQUIRE(cond)                                                     \
    do                                                                    \
    {                                                                     \
        ::testing::CountCheck();                                          \
        if(!(cond))                                                       \
        {                                                                 \
            ::testing::Fail(__FILE__, __LINE__, #cond);                   \
            throw ::testing::Abort();                                     \
        }                                                                 \
    } while(0)
