/*
  dfa_checker.c

  PURPOSE
    Compare two DFA files (produced by regex2mindfa_compiler.c) by running them on a test set.

  INPUTS
    1) reference_dfa_file   (machine-parsable format)
    2) user_dfa_file        (same format)
    3) tests_file

  TESTS FILE FORMAT
    Each non-empty, non-comment line:
      <label> <string>
    where:
      - label is 0 or 1
      - string is a sequence of alphabet symbols
      - for the EMPTY STRING, write:  <label> <eps>
    Comments: lines starting with # are ignored.

    Example:
      1 <eps>
      1 a
      0 b
      1 abbb

  OUTPUT
    Prints a verdict and first mismatch (if any).
    Exit code:
      0 => all tests matched (and labels consistent with reference if you enable that check)
      2 => mismatch
      1 => parse/usage error

  COMPILE
    gcc -O2 -Wall -Wextra -std=c11 dfa_checker.c -o dfa_checker

  RUN
    ./dfa_checker ref.dfa user.dfa tests.txt
*/

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>

#define MAX_LINE 8192
#define MAX_ALPHABET 128

static void die(const char* msg){
    fprintf(stderr,"Error: %s\n",msg);
    exit(1);
}
static void* xmalloc(size_t n){ void* p=malloc(n); if(!p) die("out of memory"); return p; }
static void* xcalloc(size_t n,size_t s){ void* p=calloc(n,s); if(!p) die("out of memory"); return p; }

typedef struct {
    int k;              /* alphabet size */
    char* alphabet;     /* string length k */
    int n;              /* states */
    int start;
    unsigned char* acc; /* length n: 0/1 */
    int* trans;         /* n*k */
} DFA;

static void dfa_free(DFA* d){
    if(!d) return;
    free(d->alphabet);
    free(d->acc);
    free(d->trans);
    memset(d,0,sizeof(*d));
}

static int alph_index(const DFA* d, char c){
    for(int i=0;i<d->k;i++) if(d->alphabet[i]==c) return i;
    return -1;
}

static int run_dfa(const DFA* d, const char* s){
    int st = d->start;
    for(size_t i=0; s[i]; i++){
        char c = s[i];
        int idx = alph_index(d, c);
        if(idx < 0) return -1; /* invalid char */
        st = d->trans[st*d->k + idx];
    }
    return d->acc[st] ? 1 : 0;
}

static void expect_token(FILE* f, const char* tok){
    char buf[64];
    if(fscanf(f,"%63s",buf)!=1) die("unexpected EOF while reading DFA");
    if(strcmp(buf,tok)!=0) die("bad DFA format: unexpected header token");
}

static DFA dfa_read(const char* path){
    DFA d; memset(&d,0,sizeof(d));
    FILE* f = fopen(path,"r");
    if(!f) die("cannot open DFA file");

    expect_token(f,"ALPHABET");
    if(fscanf(f,"%d",&d.k)!=1) die("bad DFA format: alphabet size");
    if(d.k<=0 || d.k>MAX_ALPHABET) die("bad DFA format: alphabet size range");
    d.alphabet = (char*)xmalloc((size_t)d.k + 1);

    // read the alphabet string (no spaces)
    char alphbuf[1024];
    if(fscanf(f,"%1023s",alphbuf)!=1) die("bad DFA format: alphabet string");
    if((int)strlen(alphbuf) != d.k) die("bad DFA format: alphabet string length mismatch");
    memcpy(d.alphabet, alphbuf, (size_t)d.k);
    d.alphabet[d.k]='\0';

    expect_token(f,"STATES");
    if(fscanf(f,"%d",&d.n)!=1) die("bad DFA format: states");
    if(d.n<=0) die("bad DFA format: states must be positive");

    expect_token(f,"START");
    if(fscanf(f,"%d",&d.start)!=1) die("bad DFA format: start");
    if(d.start<0 || d.start>=d.n) die("bad DFA format: start out of range");

    expect_token(f,"ACCEPT");
    int m=0;
    if(fscanf(f,"%d",&m)!=1) die("bad DFA format: accept count");
    if(m<0 || m>d.n) die("bad DFA format: accept count range");
    d.acc = (unsigned char*)xcalloc((size_t)d.n, 1);
    for(int i=0;i<m;i++){
        int a=0;
        if(fscanf(f,"%d",&a)!=1) die("bad DFA format: accept list");
        if(a<0 || a>=d.n) die("bad DFA format: accepting state out of range");
        d.acc[a]=1;
    }

    expect_token(f,"TRANS");
    d.trans = (int*)xmalloc((size_t)d.n*(size_t)d.k*sizeof(int));
    for(int s=0;s<d.n;s++){
        for(int a=0;a<d.k;a++){
            int t=0;
            if(fscanf(f,"%d",&t)!=1) die("bad DFA format: transition table");
            if(t<0 || t>=d.n) die("bad DFA format: transition out of range");
            d.trans[s*d.k + a] = t;
        }
    }

    expect_token(f,"END");
    fclose(f);

    // extra check: alphabet unique
    int seen[256]={0};
    for(int i=0;i<d.k;i++){
        unsigned char uc=(unsigned char)d.alphabet[i];
        if(seen[uc]) die("bad DFA: duplicate symbol in alphabet");
        seen[uc]=1;
    }

    return d;
}

static int same_alphabet(const DFA* a, const DFA* b){
    if(a->k != b->k) return 0;
    return memcmp(a->alphabet, b->alphabet, (size_t)a->k) == 0;
}

static void trim_newline(char* s){
    size_t n=strlen(s);
    while(n>0 && (s[n-1]=='\n' || s[n-1]=='\r')) s[--n]='\0';
}

int main(int argc, char** argv){
    if(argc != 4){
        fprintf(stderr,"Usage: %s <ref.dfa> <user.dfa> <tests.txt>\n", argv[0]);
        return 1;
    }

    DFA ref = dfa_read(argv[1]);
    DFA usr = dfa_read(argv[2]);

    if(!same_alphabet(&ref,&usr)){
        fprintf(stderr,"FAIL: alphabets differ between reference and user DFA.\n");
        fprintf(stderr,"ref: %s\nuser:%s\n", ref.alphabet, usr.alphabet);
        dfa_free(&ref); dfa_free(&usr);
        return 2;
    }

    FILE* ft = fopen(argv[3],"r");
    if(!ft) die("cannot open tests file");

    char line[MAX_LINE];
    int line_no=0;
    int total=0;
    while(fgets(line,sizeof(line),ft)){
        line_no++;
        trim_newline(line);

        // skip empty/comment
        char* p=line;
        while(*p && isspace((unsigned char)*p)) p++;
        if(*p=='\0' || *p=='#') continue;

        int label=-1;
        // label is first token
        if(*p!='0' && *p!='1'){
            fprintf(stderr,"Error: tests line %d: label must be 0 or 1\n", line_no);
            fclose(ft); dfa_free(&ref); dfa_free(&usr);
            return 1;
        }
        label = (*p=='1') ? 1 : 0;
        p++;
        // skip whitespace
        while(*p && isspace((unsigned char)*p)) p++;

        // read string token
        char strbuf[MAX_LINE];
        if(*p=='\0'){
            fprintf(stderr,"Error: tests line %d: missing string token (use <eps> for empty)\n", line_no);
            fclose(ft); dfa_free(&ref); dfa_free(&usr);
            return 1;
        }

        // take the rest as a single token (no spaces inside strings)
        // stop at whitespace
        int j=0;
        while(*p && !isspace((unsigned char)*p) && j < (int)sizeof(strbuf)-1){
            strbuf[j++] = *p++;
        }
        strbuf[j]='\0';

        const char* w = strbuf;
        char empty[1]={0};
        if(strcmp(w,"<eps>")==0) w = empty;

        int rref = run_dfa(&ref, w);
        int rusr = run_dfa(&usr, w);
        if(rref < 0 || rusr < 0){
            fprintf(stderr,"Error: tests line %d: string contains symbol not in alphabet\n", line_no);
            fclose(ft); dfa_free(&ref); dfa_free(&usr);
            return 1;
        }

        total++;

        // core check: user matches reference
        if(rref != rusr){
            fprintf(stderr,"FAIL at test line %d\n", line_no);
            fprintf(stderr,"  w = %s\n", (w[0]=='\0') ? "<eps>" : w);
            fprintf(stderr,"  ref_accept = %d, user_accept = %d\n", rref, rusr);
            fprintf(stderr,"  label = %d\n", label);
            fclose(ft); dfa_free(&ref); dfa_free(&usr);
            return 2;
        }

        // optional: sanity check that tests label matches reference
        if(rref != label){
            fprintf(stderr,"WARNING: test label mismatch vs reference at line %d (label=%d, ref=%d)\n",
                    line_no, label, rref);
        }
    }

    fclose(ft);
    printf("PASS: %d tests matched (user DFA behavior == reference DFA behavior).\n", total);

    dfa_free(&ref); dfa_free(&usr);
    return 0;
}
